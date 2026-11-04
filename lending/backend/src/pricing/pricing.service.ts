import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { computeOffer } from './pricing.calc';
import { PolicyStatus, PricingPolicy } from './pricing-policy.entity';

export type PolicyDraft = Pick<
  PricingPolicy,
  'name' | 'annualInterestBps' | 'processingFeeBps' | 'gstOnFeeBps' | 'tenureDays' | 'minPrincipalPaise' | 'maxPrincipalPaise' | 'aprCapBps' | 'coolingOffDays' | 'penalChargesText'
>;

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PricingPolicy) private readonly repo: Repository<PricingPolicy>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly audit: AuditService,
  ) {}

  async active(): Promise<PricingPolicy> {
    const p = await this.repo.findOne({ where: { status: PolicyStatus.ACTIVE } });
    if (!p) throw new ServiceUnavailableException('No active pricing policy. Lending is paused.');
    return p;
  }

  list() {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  /** Maker: Credit Risk Manager drafts. The draft is checked so that no allowed amount exceeds the APR cap. */
  async draft(input: PolicyDraft, actorId: string) {
    if (input.minPrincipalPaise <= 0 || input.maxPrincipalPaise < input.minPrincipalPaise) throw new BadRequestException('Invalid amount range');
    if (input.tenureDays < 1 || input.tenureDays > 365) throw new BadRequestException('Invalid tenure');
    // APR is highest at the smallest loan (fees are proportional, so it is flat; check both ends).
    for (const amt of [input.minPrincipalPaise, input.maxPrincipalPaise]) {
      const o = computeOffer(input, amt);
      if (o.aprBps > input.aprCapBps)
        throw new BadRequestException(`APR ${(o.aprBps / 100).toFixed(2)}% exceeds the board APR cap ${(input.aprCapBps / 100).toFixed(2)}%`);
    }
    const p = await this.repo.save(this.repo.create({ ...input, status: PolicyStatus.DRAFT, createdBy: actorId }));
    await this.audit.record({ actorType: 'STAFF', actorId, action: 'pricing.drafted', entityType: 'pricing_policy', entityId: p.id, data: { ...input } });
    return p;
  }

  /** Checker: Compliance Officer activates, quoting the board approval. Must be a different person. */
  async activate(id: string, boardApprovalRef: string, actorId: string) {
    return this.ds.transaction(async (m) => {
      const r = m.getRepository(PricingPolicy);
      const p = await r.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!p) throw new NotFoundException();
      if (p.status !== PolicyStatus.DRAFT) throw new ConflictException('Only a draft can be activated');
      if (p.createdBy === actorId) throw new ForbiddenException('Maker-checker: the person who drafted a policy cannot activate it');
      if (!boardApprovalRef?.trim()) throw new BadRequestException('Board approval reference is required');
      await r.update({ status: PolicyStatus.ACTIVE }, { status: PolicyStatus.RETIRED });
      Object.assign(p, { status: PolicyStatus.ACTIVE, activatedBy: actorId, boardApprovalRef, activatedAt: new Date() });
      await r.save(p);
      await this.audit.record({ actorType: 'STAFF', actorId, action: 'pricing.activated', entityType: 'pricing_policy', entityId: p.id, data: { boardApprovalRef } }, m);
      return p;
    });
  }
}
