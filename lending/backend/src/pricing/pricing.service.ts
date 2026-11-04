import { BadRequestException, GoneException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { computeOffer } from './pricing.calc';
import { PricingPlan } from './pricing-plan.entity';

export type PlanInput = Pick<
  PricingPlan,
  | 'name' | 'scope' | 'customerMobile' | 'customerLabel' | 'priority' | 'active' | 'validFrom' | 'validUntil' | 'maxUses'
  | 'interestUnit' | 'interestRatePercent' | 'feeType' | 'feeValue' | 'gstPercent' | 'tenureDays'
  | 'minPrincipalPaise' | 'maxPrincipalPaise' | 'penalType' | 'penalValue' | 'coolingOffDays' | 'aprCapPercent'
>;

const EDITABLE: (keyof PlanInput)[] = [
  'name', 'scope', 'customerMobile', 'customerLabel', 'priority', 'active', 'validFrom', 'validUntil', 'maxUses',
  'interestUnit', 'interestRatePercent', 'feeType', 'feeValue', 'gstPercent', 'tenureDays',
  'minPrincipalPaise', 'maxPrincipalPaise', 'penalType', 'penalValue', 'coolingOffDays', 'aprCapPercent',
];

@Injectable()
export class PricingService {
  constructor(@InjectRepository(PricingPlan) private readonly repo: Repository<PricingPlan>, private readonly audit: AuditService) {}

  static validate(p: PlanInput & { usedCount?: number }) {
    const bad = (m: string) => { throw new BadRequestException(m); };
    if (p.scope === 'CUSTOMER' && !/^[6-9]\d{9}$/.test(p.customerMobile ?? '')) bad('A customer offer needs a valid 10-digit mobile number');
    if (p.scope === 'ALL' && p.customerMobile) bad('An offer for all customers cannot have a mobile number');
    if (p.minPrincipalPaise <= 0 || p.maxPrincipalPaise < p.minPrincipalPaise) bad('Minimum amount must be above 0 and not above the maximum');
    if (p.tenureDays < 1 || p.tenureDays > 365) bad('Tenure must be 1–365 days');
    if (p.validFrom && p.validUntil && new Date(p.validFrom) >= new Date(p.validUntil)) bad('Valid-until must be after valid-from');
    if (p.maxUses != null && p.maxUses < (p.usedCount ?? 0)) bad(`Max uses cannot be below the ${p.usedCount} loans already made`);
    if (p.penalType === 'NONE' && p.penalValue) bad('Set a penal charge type or leave the value at 0');
    for (const amt of [p.minPrincipalPaise, p.maxPrincipalPaise]) {
      let apr: number;
      try {
        apr = computeOffer(p, amt).aprBps / 100;
      } catch (e) {
        return bad(`At ₹${amt / 100}: ${(e as Error).message}`);
      }
      if (p.aprCapPercent != null && apr > p.aprCapPercent) bad(`At ₹${amt / 100} the APR is ${apr.toFixed(2)}%, above your APR cap of ${p.aprCapPercent}%`);
    }
  }

  list(filter: { scope?: string; mobile?: string } = {}) {
    return this.repo.find({
      where: { ...(filter.scope && { scope: filter.scope as PricingPlan['scope'] }), ...(filter.mobile && { customerMobile: filter.mobile }) },
      order: { scope: 'ASC', priority: 'DESC', createdAt: 'DESC' },
      take: 500,
    });
  }

  async get(id: string) {
    const p = await this.repo.findOneBy({ id });
    if (!p) throw new NotFoundException('Plan not found');
    return p;
  }

  async create(input: PlanInput, actorId: string) {
    const data = { ...input, customerMobile: input.scope === 'ALL' ? null : input.customerMobile };
    PricingService.validate(data);
    const p = await this.repo.save(this.repo.create({ ...data, createdBy: actorId }));
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'pricing.plan_created', entityType: 'pricing_plan', entityId: p.id, data: { ...data } });
    return p;
  }

  /** Any field can change at any time. Offers already shown or signed keep their frozen terms. */
  async update(id: string, patch: Partial<PlanInput>, actorId: string) {
    const p = await this.get(id);
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of EDITABLE) {
      if (patch[k] === undefined) continue;
      const old = p[k] instanceof Date ? (p[k] as Date).toISOString() : p[k];
      const val = patch[k] instanceof Date ? (patch[k] as Date).toISOString() : patch[k];
      if (old !== val) { before[k] = old; after[k] = val; }
      (p as unknown as Record<string, unknown>)[k] = patch[k];
    }
    if (p.scope === 'ALL') p.customerMobile = null;
    PricingService.validate(p);
    p.updatedBy = actorId;
    await this.repo.save(p);
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'pricing.plan_updated', entityType: 'pricing_plan', entityId: p.id, data: { before, after } });
    return p;
  }

  /** The plan that applies to this customer right now. */
  async resolve(mobile: string, at = new Date(), m?: EntityManager): Promise<PricingPlan> {
    const r = (m ?? this.repo.manager).getRepository(PricingPlan);
    const base = () =>
      r.createQueryBuilder('p')
        .where('p.active = true')
        .andWhere(new Brackets((b) => b.where('p.validFrom IS NULL').orWhere('p.validFrom <= :at', { at })))
        .andWhere(new Brackets((b) => b.where('p.validUntil IS NULL').orWhere('p.validUntil > :at', { at })))
        .andWhere(new Brackets((b) => b.where('p.maxUses IS NULL').orWhere('p.usedCount < p.maxUses')))
        .orderBy('p.priority', 'DESC')
        .addOrderBy('p.createdAt', 'DESC');
    const personal = await base().andWhere(`p.scope = 'CUSTOMER'`).andWhere('p.customerMobile = :mobile', { mobile }).getOne();
    if (personal) return personal;
    const all = await base().andWhere(`p.scope = 'ALL'`).getOne();
    if (!all) throw new ServiceUnavailableException('No pricing plan is active right now. Lending is paused.');
    return all;
  }

  /** What a customer would be offered for an amount (owner's what-if tool). */
  async preview(mobile: string, amountPaise: number) {
    const plan = await this.resolve(mobile);
    if (amountPaise < plan.minPrincipalPaise || amountPaise > plan.maxPrincipalPaise)
      return { plan, offer: null, message: `Amount must be ₹${plan.minPrincipalPaise / 100}–₹${plan.maxPrincipalPaise / 100} on this plan` };
    return { plan, offer: computeOffer(plan, amountPaise) };
  }

  /** Counts a loan against the plan's max uses; called inside the e-sign transaction. */
  async consume(m: EntityManager, planId: string) {
    const r = await m.query(
      `UPDATE pricing_plans SET "usedCount" = "usedCount" + 1 WHERE id = $1 AND ("maxUses" IS NULL OR "usedCount" < "maxUses") RETURNING id`,
      [planId],
    );
    // TypeORM returns [rows, affectedCount] for UPDATE … RETURNING on Postgres.
    const rows = Array.isArray(r[0]) ? r[0] : r;
    if (!rows.length) throw new GoneException('This offer has reached its limit. Please start a new application.');
  }
}
