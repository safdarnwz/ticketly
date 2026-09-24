import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';

export interface LegalPage {
  slug: string;
  title: string;
  bodyMd: string;
  version: number;
  effectiveFrom: Date;
  updatedAt: Date;
}

/** No tenant scoping — these are Ticketly's OWN legal pages (the platform is the e-commerce entity/data fiduciary for the storefront), not any individual operator's. */
@Injectable()
export class LegalRepository {
  constructor(private readonly db: DatabaseService) {}

  async getBySlug(slug: string): Promise<LegalPage | null> {
    const row = await this.db.queryOne<{ slug: string; title: string; body_md: string; version: number; effective_from: Date; updated_at: Date }>(
      `SELECT slug, title, body_md, version, effective_from, updated_at FROM platform_legal_pages WHERE slug = $1`,
      [slug],
      { name: 'legal.getBySlug' },
    );
    return row ? { slug: row.slug, title: row.title, bodyMd: row.body_md, version: row.version, effectiveFrom: row.effective_from, updatedAt: row.updated_at } : null;
  }

  async listAll(): Promise<LegalPage[]> {
    const rows = await this.db.query<{ slug: string; title: string; body_md: string; version: number; effective_from: Date; updated_at: Date }>(
      `SELECT slug, title, body_md, version, effective_from, updated_at FROM platform_legal_pages ORDER BY slug`,
      [],
      { name: 'legal.listAll' },
    );
    return rows.map((row) => ({ slug: row.slug, title: row.title, bodyMd: row.body_md, version: row.version, effectiveFrom: row.effective_from, updatedAt: row.updated_at }));
  }

  /** Super-admin edits — bumps the version and effective_from, so a change is auditable (when the terms actually changed matters for enforceability). */
  async upsert(slug: string, title: string, bodyMd: string): Promise<void> {
    await this.db.execute_(
      `INSERT INTO platform_legal_pages (slug, title, body_md) VALUES ($1,$2,$3)
       ON CONFLICT (slug) DO UPDATE SET title = $2, body_md = $3, version = platform_legal_pages.version + 1, effective_from = now(), updated_at = now()`,
      [slug, title, bodyMd],
      { name: 'legal.upsert', primary: true },
    );
  }
}
