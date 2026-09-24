import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';

import type { PageKind, PageState, PageStatus } from '../domain/content';

export interface ContentPage {
  slug: string;
  kind: PageKind;
  title: string;
  body: string;
  status: PageStatus;
  version: number;
  effectiveFrom: Date;
  updatedAt: Date;
}

const COLUMNS = `slug, kind, title, body, status, version, effective_from AS "effectiveFrom", updated_at AS "updatedAt"`;

/** Platform-wide storefront pages, including the legal pages. */
@Injectable()
export class ContentPageRepository {
  constructor(private readonly db: DatabaseService) {}

  async findPublished(slug: string): Promise<ContentPage | null> {
    return this.db.queryOne<ContentPage>(
      `SELECT ${COLUMNS} FROM content_pages WHERE slug = $1 AND status = 'published'`,
      [slug],
      { name: 'content.findPublished' },
    );
  }

  async listPublished(kind?: PageKind): Promise<ContentPage[]> {
    return this.db.query<ContentPage>(
      `SELECT ${COLUMNS} FROM content_pages WHERE status = 'published' AND ($1::text IS NULL OR kind = $1) ORDER BY slug`,
      [kind ?? null],
      { name: 'content.listPublished' },
    );
  }

  async listAll(): Promise<ContentPage[]> {
    return this.db.query<ContentPage>(
      `SELECT ${COLUMNS} FROM content_pages ORDER BY kind, slug`,
      [],
      {
        name: 'content.listAll',
      },
    );
  }

  async stateForUpdate(slug: string): Promise<PageState | null> {
    return this.db.queryOne<PageState>(
      `SELECT kind, title, body, status, version FROM content_pages WHERE slug = $1 FOR UPDATE`,
      [slug],
      { name: 'content.stateForUpdate', primary: true },
    );
  }

  /** Save; `effective_from` moves only when the version was bumped. */
  async save(slug: string, page: PageState, bumped: boolean): Promise<void> {
    await this.db.execute_(
      `INSERT INTO content_pages (slug, kind, title, body, status, version)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, status = EXCLUDED.status,
         version = EXCLUDED.version, effective_from = CASE WHEN $7 THEN now() ELSE content_pages.effective_from END`,
      [slug, page.kind, page.title, page.body, page.status, page.version, bumped],
      { name: 'content.save', primary: true },
    );
  }
}
