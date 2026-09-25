import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AppConfig } from '@config';
import { ApiStandardErrors, RequirePlatformAdmin, zodQuery } from '@http';
import {
  BadRequestError,
  addDays,
  daysBetween,
  decodeCursor,
  encodeCursor,
  isUuid,
  localDate,
  toInstant,
  todayIn,
  type LocalDate,
} from '@kernel';

import { NotificationService } from '../../notification';
import { BookingMonitoringRepository } from '../infrastructure/persistence/booking-monitoring.repository';
import {
  BookingActivityQuerySchema,
  BookingFeedQuerySchema,
  MONITORING_MAX_DAYS,
  type BookingActivityQuery,
  type BookingFeedQuery,
} from './dto/booking-monitoring.dto';

/**
 * What is being booked across the platform, operator by operator: seats on
 * hold right now (a customer is paying), bookings confirmed and cancelled,
 * and whether each booking's e-ticket and invoice emails went out. Contact
 * details are masked. Platform admins only.
 */
@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/monitoring/bookings', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class BookingMonitoringController {
  constructor(
    private readonly monitoring: BookingMonitoringRepository,
    private readonly notifications: NotificationService,
    private readonly config: AppConfig,
  ) {}

  /** The period as instants: [from 00:00, to+1 00:00) in the platform's time zone. */
  private period(q: { from?: string; to?: string }) {
    const tz = this.config.domain.timezone;
    const today = todayIn(tz);
    const from: LocalDate = q.from ? localDate(q.from) : q.to ? localDate(q.to) : today;
    const to: LocalDate = q.to ? localDate(q.to) : q.from ? from : today;
    if (from > to) throw new BadRequestError("'from' must not be after 'to'");
    if (daysBetween(from, to) + 1 > MONITORING_MAX_DAYS)
      throw new BadRequestError(`Choose at most ${MONITORING_MAX_DAYS} days`);
    return {
      from,
      to,
      fromInstant: toInstant(from, 0, tz),
      toInstant: toInstant(addDays(to, 1), 0, tz),
    };
  }

  @Get('activity')
  @ApiOperation({
    summary:
      'Per operator: holds in progress now, bookings confirmed / cancelled, seats and gross in the period (default today)',
  })
  async activity(@Query(zodQuery(BookingActivityQuerySchema)) q: BookingActivityQuery) {
    const p = this.period(q);
    const operators = await this.monitoring.activity(p.fromInstant, p.toInstant);
    const sum = (
      k:
        | 'holdsLive'
        | 'seatsOnHold'
        | 'holdValueMinor'
        | 'confirmed'
        | 'seatsSold'
        | 'grossMinor'
        | 'cancelled',
    ) => operators.reduce((s, o) => s + o[k], 0);
    return {
      from: p.from,
      to: p.to,
      timeZone: this.config.domain.timezone,
      totals: {
        operatorsActive: operators.length,
        holdsLive: sum('holdsLive'),
        seatsOnHold: sum('seatsOnHold'),
        holdValueMinor: sum('holdValueMinor'),
        confirmed: sum('confirmed'),
        seatsSold: sum('seatsSold'),
        grossMinor: sum('grossMinor'),
        cancelled: sum('cancelled'),
      },
      operators,
    };
  }

  @Get()
  @ApiOperation({
    summary:
      'Bookings across every operator, newest first — filter by operator, status (live = being paid now), channel, PNR, dates',
  })
  async feed(@Query(zodQuery(BookingFeedQuerySchema)) q: BookingFeedQuery) {
    const p = this.period(q);
    let before: { createdAt: string; id: string } | undefined;
    if (q.cursor) {
      const c = (() => {
        try {
          return decodeCursor(q.cursor);
        } catch {
          return undefined;
        }
      })();
      const [at, id] = c?.k ?? [];
      if (c?.v !== 1 || typeof at !== 'string' || Number.isNaN(Date.parse(at)) || !isUuid(id))
        throw new BadRequestError('That page link is no longer valid — start from the first page');
      before = { createdAt: at, id: id };
    }
    const rows = await this.monitoring.feed({
      tenantId: q.tenantId,
      status: q.status,
      channel: q.channel,
      pnr: q.pnr,
      fromInstant: p.fromInstant,
      toInstant: p.toInstant,
      before,
      limit: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const items = rows.slice(0, q.limit);
    const docs = await this.notifications.documentStatus(items.map((b) => b.id));
    const last = items[items.length - 1];
    return {
      from: p.from,
      to: p.to,
      items: items.map((b) => ({ ...b, emails: docs.get(b.id) ?? {} })),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ v: 1, k: [last.createdAt.toISOString(), last.id], d: 'desc' })
          : null,
    };
  }
}
