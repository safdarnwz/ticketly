import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, type UserId } from '@kernel';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  audience: 'operators' | 'customers' | 'all';
  startsAt: Date;
  endsAt: Date | null;
  createdAt: Date;
}

/** No tenant scoping here by design — this is a platform-wide broadcast, not a per-operator resource. */
@Injectable()
export class AnnouncementRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(input: {
    title: string;
    body: string;
    severity?: 'info' | 'warning' | 'critical';
    audience?: 'operators' | 'customers' | 'all';
    startsAt?: string;
    endsAt?: string;
    createdBy?: UserId | null;
  }): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO announcements (id, title, body, severity, audience, starts_at, ends_at, created_by)
       VALUES ($1,$2,$3,$4,$5,coalesce($6,now()),$7,$8)`,
      [
        id,
        input.title,
        input.body,
        input.severity ?? 'info',
        input.audience ?? 'operators',
        input.startsAt ?? null,
        input.endsAt ?? null,
        input.createdBy ?? null,
      ],
      { name: 'announcement.create', primary: true },
    );
    return id;
  }

  async delete(id: string): Promise<void> {
    await this.db.execute_(`DELETE FROM announcements WHERE id = $1`, [id], {
      name: 'announcement.delete',
      primary: true,
    });
  }

  async listAll(): Promise<Announcement[]> {
    const rows = await this.db.query<Row>(
      `SELECT id, title, body, severity, audience, starts_at, ends_at, created_at FROM announcements ORDER BY created_at DESC`,
      [],
      { name: 'announcement.listAll' },
    );
    return rows.map(map);
  }

  /** Currently-active announcements for a given audience — what operators/customers actually see. */
  async active(audience: 'operators' | 'customers'): Promise<Announcement[]> {
    const rows = await this.db.query<Row>(
      `SELECT id, title, body, severity, audience, starts_at, ends_at, created_at FROM announcements
        WHERE (audience = $1 OR audience = 'all') AND starts_at <= now() AND (ends_at IS NULL OR ends_at >= now())
        ORDER BY severity DESC, created_at DESC`,
      [audience],
      { name: 'announcement.active' },
    );
    return rows.map(map);
  }
}

interface Row {
  id: string;
  title: string;
  body: string;
  severity: Announcement['severity'];
  audience: Announcement['audience'];
  starts_at: Date;
  ends_at: Date | null;
  created_at: Date;
}
function map(r: Row): Announcement {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    severity: r.severity,
    audience: r.audience,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    createdAt: r.created_at,
  };
}
