import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode, NotFoundError } from '@kernel';

import { OperatorBroadcastService } from '../../../tenancy';
import {
  MaintenanceWindowRepository,
  type MaintenanceWindow,
} from '../../infrastructure/persistence/maintenance-window.repository';

const MAX_WINDOW_HOURS = 24;

/**
 * Scheduled maintenance (#109). While a window runs, the maintenance guard
 * treats the platform as in maintenance mode (writes get a retryable 503).
 * Operators can be emailed about it when it is scheduled or later (#110).
 */
@Injectable()
export class MaintenanceWindowService {
  constructor(
    private readonly windows: MaintenanceWindowRepository,
    private readonly broadcasts: OperatorBroadcastService,
  ) {}

  async schedule(
    input: { startsAt: string; endsAt: string; message: string; notifyOperators: boolean },
    actorId: string | null,
  ): Promise<{ window: MaintenanceWindow; notified: { sent: number; failed: number } | null }> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (startsAt.getTime() <= Date.now()) throw validation('The window must start in the future');
    if (endsAt <= startsAt) throw validation('The window must end after it starts');
    if (endsAt.getTime() - startsAt.getTime() > MAX_WINDOW_HOURS * 3_600_000)
      throw validation(`A window lasts at most ${MAX_WINDOW_HOURS} hours`);
    if ((await this.windows.overlapping(startsAt, endsAt)) > 0)
      throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
        message: 'Another maintenance window overlaps this time',
      });
    const id = await this.windows.create({ startsAt, endsAt, message: input.message }, actorId);
    const notified = input.notifyOperators ? await this.notify(id, actorId) : null;
    return { window: (await this.windows.find(id))!, notified };
  }

  list(includePast: boolean): Promise<MaintenanceWindow[]> {
    return this.windows.list(includePast);
  }

  async cancel(id: string): Promise<void> {
    if (!(await this.windows.cancel(id)))
      throw new NotFoundError('Upcoming or running maintenance window', id);
  }

  /** Email every active operator about the window (#110). */
  async notify(id: string, actorId: string | null): Promise<{ sent: number; failed: number }> {
    const w = await this.windows.find(id);
    if (!w || w.cancelledAt) throw new NotFoundError('Maintenance window', id);
    const ist = (d: Date) =>
      d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    const result = await this.broadcasts.send(
      {
        subject: `Scheduled maintenance: ${ist(w.startsAt)} – ${ist(w.endsAt)} IST`,
        body:
          `Ticketly will be under maintenance from ${ist(w.startsAt)} to ${ist(w.endsAt)} (IST). ` +
          `During this time new bookings, cancellations and other changes are paused; ` +
          `searches and existing tickets keep working.` +
          (w.message ? `\n\n${w.message}` : ''),
        audience: 'active',
        source: 'maintenance',
      },
      actorId,
    );
    await this.windows.markNotified(id);
    return { sent: result.sent, failed: result.failed };
  }
}

function validation(message: string): AppError {
  return new AppError(ErrorCode.COMMON_VALIDATION, 422, { message });
}
