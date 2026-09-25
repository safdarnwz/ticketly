import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId } from '@kernel';

export interface MaintenanceWindow {
  id: string;
  startsAt: Date;
  endsAt: Date;
  message: string;
  notifiedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

const COLUMNS = `id, starts_at AS "startsAt", ends_at AS "endsAt", message, notified_at AS "notifiedAt",
  cancelled_at AS "cancelledAt", created_at AS "createdAt"`;

/** Scheduled platform maintenance (#109). Platform data, no RLS. */
@Injectable()
export class MaintenanceWindowRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(
    w: { startsAt: Date; endsAt: Date; message: string },
    actorId: string | null,
  ): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO maintenance_windows (id, starts_at, ends_at, message, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [id, w.startsAt, w.endsAt, w.message, actorId],
      { name: 'maintenanceWindow.create', primary: true },
    );
    return id;
  }

  find(id: string): Promise<MaintenanceWindow | null> {
    return this.db.queryOne(`SELECT ${COLUMNS} FROM maintenance_windows WHERE id = $1`, [id], {
      name: 'maintenanceWindow.find',
      primary: true,
    });
  }

  /** Windows not yet over (upcoming or running), soonest first; cancelled ones too when asked. */
  list(includePast: boolean): Promise<MaintenanceWindow[]> {
    return this.db.query(
      `SELECT ${COLUMNS} FROM maintenance_windows
        WHERE $1 OR (ends_at > now() AND cancelled_at IS NULL)
        ORDER BY starts_at DESC LIMIT 200`,
      [includePast],
      { name: 'maintenanceWindow.list' },
    );
  }

  /** The window running right now, if any. */
  current(): Promise<MaintenanceWindow | null> {
    return this.db.queryOne(
      `SELECT ${COLUMNS} FROM maintenance_windows
        WHERE cancelled_at IS NULL AND starts_at <= now() AND ends_at > now()
        ORDER BY ends_at DESC LIMIT 1`,
      [],
      { name: 'maintenanceWindow.current' },
    );
  }

  /** Windows that would overlap [startsAt, endsAt). */
  async overlapping(startsAt: Date, endsAt: Date): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM maintenance_windows
        WHERE cancelled_at IS NULL AND starts_at < $2 AND ends_at > $1`,
      [startsAt, endsAt],
      { name: 'maintenanceWindow.overlapping', primary: true },
    );
    return Number(row?.n ?? 0);
  }

  async cancel(id: string): Promise<boolean> {
    const n = await this.db.execute_(
      `UPDATE maintenance_windows SET cancelled_at = now() WHERE id = $1 AND cancelled_at IS NULL AND ends_at > now()`,
      [id],
      { name: 'maintenanceWindow.cancel', primary: true },
    );
    return n > 0;
  }

  async markNotified(id: string): Promise<void> {
    await this.db.execute_(
      `UPDATE maintenance_windows SET notified_at = now() WHERE id = $1`,
      [id],
      { name: 'maintenanceWindow.markNotified', primary: true },
    );
  }
}
