import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  AppError,
  ConflictError,
  ErrorCode,
  NotFoundError,
  getUserId,
  localDate,
  runAsTenant,
  type BookingId,
  type CityId,
  type StopId,
  type TenantId,
  type TripId,
} from '@kernel';

import { agentCommissionMinor, checkFunds, spendableMinor } from '../../agents';
import { BookingService, BookingRepository } from '../../booking';
import { PaymentService } from '../../payment';
import { PricingService } from '../../pricing';
import { InventoryRepository } from '../../scheduling';
import { SearchService } from '../../search';
import { generateKey } from '../domain/gds-keys';
import { WebhookDeliveryService, WebhookRepository } from '../../webhooks';
import { GdsRepository, type GdsPartner } from '../infrastructure/gds.repository';
import {
  type AgreementStatus,
  type BillingMode,
  type PartnerStatus,
  type SettablePartnerStatus,
} from '../domain/gds-partner';

export interface PartnerCtx {
  partner: GdsPartner;
  keyId: string;
  sandbox: boolean;
}

/**
 * ============================================================================
 *  GDS — one integration, every operator
 * ============================================================================
 *
 * PARTNER API (OTAs like redBus / AbhiBus / Paytm, multi-operator agents):
 *   search → seats → block (hold) → confirm (debits the partner's account,
 *   net of commission) → cancel (refund credited back) — across every
 *   operator with an ACTIVE agreement with that partner, excluding trips whose
 *   OTA sales the operator has closed. Every write runs inside the owning
 *   operator's tenant; a partner can only ever see/act on bookings it made.
 * PLATFORM ADMIN: onboard partners, credit terms, receipts, API keys.
 * OPERATOR: choose which partners may sell and at what commission.
 */
@Injectable()
export class GdsService {
  constructor(
    private readonly gds: GdsRepository,
    private readonly search: SearchService,
    private readonly pricing: PricingService,
    private readonly bookingService: BookingService,
    private readonly bookings: BookingRepository,
    private readonly payments: PaymentService,
    private readonly inventory: InventoryRepository,
    private readonly uow: UnitOfWork,
    private readonly webhooks: WebhookRepository,
    private readonly webhookDelivery: WebhookDeliveryService,
  ) {}

  /* ───────────── partner API ───────────── */

  async searchTrips(
    ctx: PartnerCtx,
    dto: { originCityId: string; destCityId: string; journeyDate: string },
  ) {
    const agreements = await this.gds.agreementsFor(ctx.partner.id);
    if (!agreements.size) return { count: 0, results: [] };
    const all = await this.search.search({
      originCityId: dto.originCityId as CityId,
      destCityId: dto.destCityId as CityId,
      journeyDate: localDate(dto.journeyDate),
    });
    const mine = all.filter((r) => agreements.has(r.tenantId));
    const closed = await this.gds.tripsClosedForOta(mine.map((r) => r.tripId));
    const results = mine
      .filter((r) => !closed.has(r.tripId))
      .map((r) => ({ ...r, partnerCommissionPct: agreements.get(r.tenantId) }));
    return { count: results.length, results };
  }

  async seats(ctx: PartnerCtx, tripId: string, fromStopId: string, toStopId: string) {
    const { tenantId } = await this.assertTripSellable(ctx, tripId);
    return runAsTenant(tenantId as TenantId, async () => {
      const seg = await this.inventory.resolveSegment(
        tripId as TripId,
        fromStopId as StopId,
        toStopId as StopId,
      );
      if (!seg)
        throw new AppError(ErrorCode.INVENTORY_SEGMENT_INVALID, 422, {
          message: 'Invalid boarding/dropping combination',
        });
      return {
        tripId,
        seats: await this.inventory.seatAvailability(tripId as TripId, seg.fromSeq, seg.toSeq),
      };
    });
  }

  /** Block (hold) seats for the partner's customer; pay via confirm before the hold expires. */
  async block(
    ctx: PartnerCtx,
    dto: {
      tripId: string;
      fromStopId: string;
      toStopId: string;
      seatNumbers: string[];
      passengers: { seatNumber: string; fullName: string; age?: number; gender?: string }[];
      contactPhone: string;
      contactEmail?: string;
    },
  ) {
    this.assertLive(ctx);
    const { tenantId, commissionPct } = await this.assertTripSellable(ctx, dto.tripId);
    return runAsTenant(tenantId as TenantId, async () => {
      const types = await this.inventory.seatTypes(dto.tripId as TripId, dto.seatNumbers);
      const distinct = new Set([...types.values()].map((t) => t.seatType));
      if (distinct.size !== 1)
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message:
            'Book one seat type per request (seater and sleeper seats need separate bookings)',
        });
      const quote = await this.pricing.quote({
        tripId: dto.tripId as TripId,
        fromStopId: dto.fromStopId as StopId,
        toStopId: dto.toStopId as StopId,
        seatType: [...distinct][0],
        seatNumbers: dto.seatNumbers,
      });
      const held = await this.bookingService.hold({
        quoteId: quote.quoteId,
        seatNumbers: dto.seatNumbers,
        passengers: dto.passengers,
        contactPhone: dto.contactPhone,
        contactEmail: dto.contactEmail,
        channel: 'ota',
      });
      await this.gds.setBookingPartner(held.bookingId, ctx.partner.id);
      // Same formula and inputs confirm() will use, so the estimate here matches the charge.
      const booking = await this.bookings.findForUpdate(held.bookingId);
      const commissionMinor = agentCommissionMinor(
        held.totalMinor,
        booking?.taxMinor ?? 0,
        commissionPct,
      );
      return {
        bookingId: held.bookingId,
        pnr: held.pnr,
        holdExpiresAt: held.holdExpiresAt,
        totalMinor: held.totalMinor,
        commissionMinor,
        netPayableMinor: held.totalMinor - commissionMinor,
        operatorId: tenantId,
      };
    });
  }

  /** Confirm: debit the partner's account (net of commission) FIRST under a row lock, then issue tickets; reverse the debit if issuing fails. */
  async confirm(ctx: PartnerCtx, bookingId: string) {
    this.assertLive(ctx);
    const owner = await this.assertOwnBooking(ctx, bookingId);
    const commissionPct = (await this.gds.agreementsFor(ctx.partner.id)).get(owner.tenantId);
    if (commissionPct === undefined)
      throw new AppError(ErrorCode.COMMON_FORBIDDEN, 403, {
        message: 'This operator is no longer distributing to you',
      });

    return runAsTenant(owner.tenantId as TenantId, async () => {
      const booking = await this.bookings.findForUpdate(bookingId as BookingId);
      if (!booking) throw new NotFoundError('Booking', bookingId);
      if (booking.status === 'confirmed')
        return { bookingId, pnr: booking.pnr, status: 'confirmed', alreadyConfirmed: true };
      if (booking.status !== 'held')
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: `Booking is ${booking.status}`,
        });
      if (booking.holdExpiresAt && booking.holdExpiresAt < new Date())
        throw new AppError(ErrorCode.INVENTORY_HOLD_EXPIRED, 422, {
          message: 'The seat block has expired — block again',
        });

      const commissionMinor = agentCommissionMinor(
        booking.totalMinor,
        booking.taxMinor,
        commissionPct,
      );
      await this.uow.run({ name: 'gds.debit' }, async () => {
        const p = await this.gds.getPartner(ctx.partner.id, true);
        if (!p || p.status !== 'active')
          throw new AppError(ErrorCode.COMMON_FORBIDDEN, 403, {
            message: 'Partner account is not active',
          });
        const funds = checkFunds({
          balanceMinor: p.balanceMinor,
          creditLimitMinor: p.creditLimitMinor,
          totalMinor: booking.totalMinor,
          commissionMinor,
        });
        if (!funds.ok)
          throw new AppError(ErrorCode.AGENT_INSUFFICIENT_FUNDS, 402, {
            message: `Insufficient GDS balance/credit — short by ₹${(funds.shortfallMinor / 100).toFixed(2)}`,
            details: { shortfallMinor: funds.shortfallMinor },
          });
        await this.gds.post({
          partnerId: p.id,
          kind: 'booking_debit',
          magnitudeMinor: booking.totalMinor,
          tenantId: owner.tenantId,
          bookingId,
          reference: `booking:${bookingId}`,
          note: booking.pnr,
        });
        if (commissionMinor > 0)
          await this.gds.post({
            partnerId: p.id,
            kind: 'commission_credit',
            magnitudeMinor: commissionMinor,
            tenantId: owner.tenantId,
            bookingId,
            reference: `booking:${bookingId}`,
            note: `${commissionPct}%`,
          });
      });
      try {
        const { pnr } = await this.payments.confirmGdsBooking(
          bookingId as BookingId,
          ctx.partner.id,
          commissionMinor,
        );
        return {
          bookingId,
          pnr,
          status: 'confirmed',
          totalMinor: booking.totalMinor,
          commissionMinor,
          chargedMinor: booking.totalMinor - commissionMinor,
        };
      } catch (e) {
        await this.uow.run({ name: 'gds.reverse' }, async () => {
          await this.gds.getPartner(ctx.partner.id, true);
          await this.gds.post({
            partnerId: ctx.partner.id,
            kind: 'booking_reversal',
            magnitudeMinor: booking.totalMinor,
            tenantId: owner.tenantId,
            bookingId,
            reference: `booking:${bookingId}`,
            note: 'ticket not issued',
          });
          if (commissionMinor > 0)
            await this.gds.post({
              partnerId: ctx.partner.id,
              kind: 'commission_reversal',
              magnitudeMinor: commissionMinor,
              tenantId: owner.tenantId,
              bookingId,
              reference: `booking:${bookingId}`,
              note: 'ticket not issued',
            });
        });
        throw e;
      }
    });
  }

  /** Cancel all or some seats of the partner's OWN booking. The refund is credited to the partner's account. */
  async cancel(
    ctx: PartnerCtx,
    bookingId: string,
    input: { seatNumbers?: string[]; reason?: string },
  ) {
    this.assertLive(ctx);
    const owner = await this.assertOwnBooking(ctx, bookingId);
    return runAsTenant(owner.tenantId as TenantId, () =>
      input.seatNumbers?.length
        ? this.bookingService.cancelSeats(
            bookingId as BookingId,
            input.seatNumbers,
            input.reason ?? `cancelled via ${ctx.partner.code}`,
          )
        : this.bookingService.cancel(
            bookingId as BookingId,
            input.reason ?? `cancelled via ${ctx.partner.code}`,
          ),
    );
  }

  async bookingDetail(ctx: PartnerCtx, bookingId: string) {
    const owner = await this.assertOwnBooking(ctx, bookingId);
    return runAsTenant(owner.tenantId as TenantId, async () => {
      const booking = await this.bookings.findForUpdate(bookingId as BookingId);
      const [passengers, tickets] = await Promise.all([
        this.bookings.loadPassengers(bookingId as BookingId),
        this.bookings.listTickets(bookingId as BookingId),
      ]);
      return { booking, passengers, tickets };
    });
  }

  async account(ctx: PartnerCtx) {
    const p = (await this.gds.getPartner(ctx.partner.id))!;
    return {
      code: p.code,
      name: p.name,
      status: p.status,
      billingMode: p.billingMode,
      balanceMinor: p.balanceMinor,
      creditLimitMinor: p.creditLimitMinor,
      spendableMinor: spendableMinor(p.balanceMinor, p.creditLimitMinor),
      sandbox: ctx.sandbox,
      recent: await this.gds.ledger(p.id, 50),
    };
  }

  /* ───────────── platform admin ───────────── */

  /* ── partner webhook (delivered by the shared webhooks engine) ── */

  async partnerWebhook(id: string) {
    await this.requirePartner(id);
    const [endpoint, deliveries] = await Promise.all([
      this.webhooks.getForPartner(id),
      this.webhooks.deliveriesForPartner(id),
    ]);
    return { endpoint, deliveries };
  }

  /** Set/replace the partner's endpoint. Returns the NEW signing secret once. */
  async setPartnerWebhook(id: string, i: { url: string; eventTypes: string[] }) {
    const partner = await this.requirePartner(id);
    return this.webhooks.setForPartner({
      gdsPartnerId: id,
      name: `${partner.name} (GDS)`,
      url: i.url,
      eventTypes: i.eventTypes,
      createdBy: getUserId() ?? null,
    });
  }

  async removePartnerWebhook(id: string): Promise<void> {
    await this.requirePartner(id);
    await this.webhooks.removeForPartner(id);
  }

  async testPartnerWebhook(id: string) {
    await this.requirePartner(id);
    const target = await this.webhooks.targetForPartner(id);
    if (!target) throw new NotFoundError('Webhook for GDS partner', id);
    return this.webhookDelivery.sendTest(target);
  }

  private async requirePartner(id: string): Promise<GdsPartner> {
    const p = await this.gds.getPartner(id);
    if (!p) throw new NotFoundError('GDS partner', id);
    return p;
  }

  createPartner(i: Parameters<GdsRepository['createPartner']>[0]) {
    return this.gds.createPartner(i);
  }
  listPartners(status?: PartnerStatus) {
    return this.gds.listPartners(status);
  }
  async partnerDetail(id: string) {
    const p = await this.gds.getPartner(id);
    if (!p) throw new NotFoundError('GDS partner', id);
    return {
      ...p,
      spendableMinor: spendableMinor(p.balanceMinor, p.creditLimitMinor),
      keys: await this.gds.listKeys(id),
      ledger: await this.gds.ledger(id, 100),
    };
  }
  async setStatus(id: string, status: SettablePartnerStatus, reason?: string) {
    if (status === 'suspended' && (reason?.trim().length ?? 0) < 10)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'A reason of at least 10 characters is required to suspend',
      });
    if (!(await this.gds.getPartner(id))) throw new NotFoundError('GDS partner', id);
    await this.gds.updatePartner(id, { status, statusReason: reason?.trim() ?? null });
  }
  async setTerms(
    id: string,
    i: {
      billingMode?: BillingMode;
      creditLimitMinor?: number;
      defaultCommissionPct?: number;
    },
  ) {
    await this.uow.run({ name: 'gds.setTerms' }, async () => {
      const p = await this.gds.getPartner(id, true);
      if (!p) throw new NotFoundError('GDS partner', id);
      const mode = i.billingMode ?? p.billingMode;
      const limit = mode === 'prepaid' ? 0 : (i.creditLimitMinor ?? p.creditLimitMinor);
      if (p.balanceMinor + limit < 0)
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: 'The partner already owes more than this credit limit — collect payment first',
        });
      await this.gds.updatePartner(id, {
        billingMode: mode,
        creditLimitMinor: limit,
        defaultCommissionPct: i.defaultCommissionPct,
      });
    });
  }
  async receipt(id: string, amountMinor: number, reference: string) {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'Amount must be a positive whole number of paise',
      });
    return this.uow.run({ name: 'gds.receipt' }, async () => {
      const p = await this.gds.getPartner(id, true);
      if (!p) throw new NotFoundError('GDS partner', id);
      const r = await this.gds.post({
        partnerId: id,
        kind: p.billingMode === 'prepaid' ? 'deposit' : 'payment_received',
        magnitudeMinor: amountMinor,
        reference: `receipt:${reference.trim()}`,
        createdBy: getUserId() ?? null,
      });
      return { applied: r.applied };
    });
  }
  async issueKey(
    partnerId: string,
    i: { label: string; sandbox: boolean; ipAllowlist: string[]; expiresInDays?: number },
  ) {
    if (!(await this.gds.getPartner(partnerId))) throw new NotFoundError('GDS partner', partnerId);
    const k = generateKey(i.sandbox);
    const expiresAt = i.expiresInDays ? new Date(Date.now() + i.expiresInDays * 86_400_000) : null;
    const id = await this.gds.createKey({
      partnerId,
      label: i.label,
      prefix: k.prefix,
      hash: k.hash,
      sandbox: i.sandbox,
      ipAllowlist: i.ipAllowlist,
      expiresAt,
    });
    return { id, key: k.key, note: 'Store this key now — it is shown only once.' };
  }
  async revokeKey(partnerId: string, keyId: string) {
    if (!(await this.gds.revokeKey(partnerId, keyId))) throw new NotFoundError('API key', keyId);
  }

  /* ───────────── operator ───────────── */

  partnersForOperator() {
    return this.gds.agreementsOfTenant();
  }
  async setAgreement(partnerId: string, status: AgreementStatus, commissionPct: number) {
    const p = await this.gds.getPartner(partnerId);
    if (!p || p.status !== 'active') throw new NotFoundError('GDS partner', partnerId);
    if (!(commissionPct >= 0 && commissionPct <= 30))
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'Commission must be 0–30%' });
    await this.gds.upsertAgreement(partnerId, status, commissionPct);
  }

  /* ───────────── guards ───────────── */

  private assertLive(ctx: PartnerCtx): void {
    if (ctx.sandbox)
      throw new AppError(ErrorCode.COMMON_FORBIDDEN, 403, {
        message:
          'Sandbox keys are read-only (search, seats, account). Use a live key to block/confirm/cancel.',
      });
    if (ctx.partner.status !== 'active')
      throw new AppError(ErrorCode.COMMON_FORBIDDEN, 403, {
        message: 'Partner account is not active',
      });
  }

  private async assertTripSellable(
    ctx: PartnerCtx,
    tripId: string,
  ): Promise<{ tenantId: string; commissionPct: number }> {
    const owner = /^[0-9a-f-]{36}$/i.test(tripId) ? await this.gds.tripOwner(tripId) : null;
    const pct = owner
      ? (await this.gds.agreementsFor(ctx.partner.id)).get(owner.tenantId)
      : undefined;
    // Same 404 for "no such trip" and "operator does not distribute to you".
    if (!owner || pct === undefined) throw new NotFoundError('Trip', tripId);
    if (owner.closed.includes('ota'))
      throw new ConflictError('The operator has stopped partner sales for this trip');
    return { tenantId: owner.tenantId, commissionPct: pct };
  }

  private async assertOwnBooking(
    ctx: PartnerCtx,
    bookingId: string,
  ): Promise<{ tenantId: string }> {
    const owner = await this.gds.bookingOwner(bookingId);
    if (!owner || owner.partnerId !== ctx.partner.id) throw new NotFoundError('Booking', bookingId);
    return { tenantId: owner.tenantId };
  }
}
