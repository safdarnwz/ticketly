import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId } from '@kernel';

export interface Banner {
  id: string;
  title: string;
  imageUrl: string | null;
  linkUrl: string | null;
  sortOrder: number;
}

export interface Offer {
  code: string;
  title: string;
  description: string | null;
  couponCode: string | null;
  bannerUrl: string | null;
  validFrom: Date;
  validTo: Date;
}

/**
 * Storefront banners and marketing offers, each shown only inside its
 * validity window (evaluated at read time — an expired promo simply stops
 * showing, no sweeper needed). Offers upsert on their code.
 */
@Injectable()
export class PromoContentRepository {
  constructor(private readonly db: DatabaseService) {}

  async activeBanners(now: Date): Promise<Banner[]> {
    return this.db.query<Banner>(
      `SELECT id, title, image_url AS "imageUrl", link_url AS "linkUrl", sort_order AS "sortOrder"
         FROM cms_banners
        WHERE is_active = true
          AND (active_from IS NULL OR active_from <= $1)
          AND (active_to   IS NULL OR active_to   >= $1)
        ORDER BY sort_order, id`,
      [now],
      { name: 'content.activeBanners' },
    );
  }

  async insertBanner(input: {
    title: string;
    imageUrl: string | null;
    imageFileId: string;
    linkUrl?: string;
    sortOrder: number;
    activeFrom?: string;
    activeTo?: string;
  }): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO cms_banners (id, title, image_url, image_file_id, link_url, sort_order, active_from, active_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        input.title,
        input.imageUrl,
        input.imageFileId,
        input.linkUrl ?? null,
        input.sortOrder,
        input.activeFrom ?? null,
        input.activeTo ?? null,
      ],
      { name: 'content.insertBanner', primary: true },
    );
    return id;
  }

  async setBannerActive(id: string, isActive: boolean): Promise<boolean> {
    const n = await this.db.execute_(
      `UPDATE cms_banners SET is_active = $2 WHERE id = $1`,
      [id, isActive],
      {
        name: 'content.setBannerActive',
        primary: true,
      },
    );
    return n > 0;
  }

  async upsertOffer(input: {
    code: string;
    title: string;
    description?: string;
    couponCode?: string;
    bannerUrl: string | null;
    bannerFileId: string | null;
    validFrom: string;
    validTo: string;
  }): Promise<string> {
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO offers (id, code, title, description, coupon_code, banner_url, banner_file_id, valid_from, valid_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
         coupon_code = EXCLUDED.coupon_code, banner_url = EXCLUDED.banner_url, banner_file_id = EXCLUDED.banner_file_id,
         valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to, updated_at = now()
       RETURNING id`,
      [
        newId(),
        input.code,
        input.title,
        input.description ?? null,
        input.couponCode ?? null,
        input.bannerUrl,
        input.bannerFileId,
        input.validFrom,
        input.validTo,
      ],
      { name: 'content.upsertOffer', primary: true },
    );
    return row!.id;
  }

  async liveOffers(now: Date): Promise<Offer[]> {
    return this.db.query<Offer>(
      `SELECT code, title, description, coupon_code AS "couponCode", banner_url AS "bannerUrl",
              valid_from AS "validFrom", valid_to AS "validTo"
         FROM offers
        WHERE is_active = true AND valid_from <= $1 AND valid_to >= $1
        ORDER BY valid_to`,
      [now],
      { name: 'content.liveOffers' },
    );
  }
}
