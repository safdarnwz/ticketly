import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId } from '@kernel';

/**
 * CMS + offers persistence — PLATFORM-WIDE (see migration 0018). Customers
 * browse the one central storefront (www.ticketly.com), so pages/banners/
 * offers are Ticketly's own content, not any one operator's. Pages and offers
 * upsert on their natural key (slug / code) so re-publishing edits in place
 * rather than duplicating.
 */
@Injectable()
export class CmsRepository {
  constructor(private readonly db: DatabaseService) {}

  // ── Pages ────────────────────────────────────────────────────────────────
  async upsertPage(input: { slug: string; title: string; body: string; status: string }): Promise<string> {
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO cms_pages (id, slug, title, body, status)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, status = EXCLUDED.status, updated_at = now()
       RETURNING id`,
      [newId(), input.slug, input.title, input.body, input.status],
      { name: 'cms.upsertPage', primary: true },
    );
    return row?.id ?? '';
  }

  async getPage(slug: string): Promise<unknown | null> {
    return this.db.queryOne(
      `SELECT slug, title, body, status, updated_at AS "updatedAt" FROM cms_pages
        WHERE slug = $1 AND status = 'published'`,
      [slug],
      { name: 'cms.getPage' },
    );
  }

  // ── Banners ──────────────────────────────────────────────────────────────
  async listActiveBanners(nowIso: string): Promise<unknown[]> {
    return this.db.query(
      `SELECT id, title, image_url AS "imageUrl", link_url AS "linkUrl", sort_order AS "sortOrder"
         FROM cms_banners
        WHERE is_active = true
          AND (active_from IS NULL OR active_from <= $1)
          AND (active_to   IS NULL OR active_to   >= $1)
        ORDER BY sort_order, id`,
      [nowIso],
      { name: 'cms.listBanners' },
    );
  }

  async insertBanner(input: { title: string; imageUrl?: string; imageFileId?: string; linkUrl?: string; sortOrder: number; activeFrom?: string; activeTo?: string }): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO cms_banners (id, title, image_url, link_url, sort_order, active_from, active_to, image_file_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, input.title, input.imageUrl ?? null, input.linkUrl ?? null, input.sortOrder, input.activeFrom ?? null, input.activeTo ?? null, input.imageFileId ?? null],
      { name: 'cms.insertBanner', primary: true },
    );
    return id;
  }

  // ── Offers ───────────────────────────────────────────────────────────────
  async upsertOffer(input: { code: string; title: string; description?: string; couponCode?: string; bannerUrl?: string; bannerFileId?: string; validFrom: string; validTo: string }): Promise<string> {
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO offers (id, code, title, description, coupon_code, banner_url, valid_from, valid_to, banner_file_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
         coupon_code = EXCLUDED.coupon_code, banner_url = EXCLUDED.banner_url, banner_file_id = EXCLUDED.banner_file_id,
         valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to, updated_at = now()
       RETURNING id`,
      [newId(), input.code, input.title, input.description ?? null, input.couponCode ?? null, input.bannerUrl ?? null, input.validFrom, input.validTo, input.bannerFileId ?? null],
      { name: 'cms.upsertOffer', primary: true },
    );
    return row?.id ?? '';
  }

  async listLiveOffers(nowIso: string): Promise<unknown[]> {
    return this.db.query(
      `SELECT code, title, description, coupon_code AS "couponCode", banner_url AS "bannerUrl",
              valid_from AS "validFrom", valid_to AS "validTo"
         FROM offers
        WHERE is_active = true AND valid_from <= $1 AND valid_to >= $1
        ORDER BY valid_to`,
      [nowIso],
      { name: 'cms.listOffers' },
    );
  }
}
