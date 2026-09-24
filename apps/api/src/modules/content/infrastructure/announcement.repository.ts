import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, type UserId } from '@kernel';

import type { AnnouncementAudience, AnnouncementSeverity } from '../domain/content';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  audience: AnnouncementAudience;
  startsAt: Date;
  endsAt: Date | null;
  createdAt: Date;
}

const COLUMNS = `id, title, body, severity, audience, starts_at AS "startsAt", ends_at AS "endsAt", created_at AS "createdAt"`;

/** Platform-wide broadcasts to operators and/or customers (no tenant scope by design). */
@Injectable()
export class AnnouncementRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(input: {
    title: string;
    body: string;
    severity: AnnouncementSeverity;
    audience: AnnouncementAudience;
    startsAt?: string;
    endsAt?: string;
    createdBy: UserId | null;
  }): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO announcements (id, title, body, severity, audience, starts_at, ends_at, created_by)
       VALUES ($1,$2,$3,$4,$5,coalesce($6,now()),$7,$8)`,
      [
        id,
        input.title,
        input.body,
        input.severity,
        input.audience,
        input.startsAt ?? null,
        input.endsAt ?? null,
        input.createdBy,
      ],
      { name: 'announcement.create', primary: true },
    );
    return id;
  }

  async delete(id: string): Promise<boolean> {
    const n = await this.db.execute_(`DELETE FROM announcements WHERE id = $1`, [id], {
      name: 'announcement.delete',
      primary: true,
    });
    return n > 0;
  }

  async listAll(): Promise<Announcement[]> {
    return this.db.query<Announcement>(
      `SELECT ${COLUMNS} FROM announcements ORDER BY created_at DESC`,
      [],
      {
        name: 'announcement.listAll',
      },
    );
  }

  /** What an audience sees right now — most severe first (severity is text, so rank it explicitly). */
  async active(audience: Exclude<AnnouncementAudience, 'all'>): Promise<Announcement[]> {
    return this.db.query<Announcement>(
      `SELECT ${COLUMNS} FROM announcements
        WHERE (audience = $1 OR audience = 'all') AND starts_at <= now() AND (ends_at IS NULL OR ends_at >= now())
        ORDER BY CASE severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END DESC, created_at DESC`,
      [audience],
      { name: 'announcement.active' },
    );
  }
}
