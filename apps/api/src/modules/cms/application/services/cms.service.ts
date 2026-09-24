import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode } from '@kernel';

import { CmsRepository } from '../../infrastructure/persistence/cms.repository';

/**
 * Storefront CMS: content pages, promotional banners, and marketing offers.
 * Offers/banners are surfaced only within their validity window (evaluated at
 * read time against "now"), so an expired promo simply stops showing — no
 * sweeper needed for display correctness.
 */
@Injectable()
export class CmsService {
  constructor(private readonly repo: CmsRepository) {}

  private now(): string {
    return new Date().toISOString();
  }

  upsertPage(input: {
    slug: string;
    title: string;
    body: string;
    status?: 'draft' | 'published';
  }): Promise<string> {
    return this.repo.upsertPage({
      slug: input.slug,
      title: input.title,
      body: input.body,
      status: input.status ?? 'draft',
    });
  }

  async getPage(slug: string): Promise<unknown> {
    const page = await this.repo.getPage(slug);
    if (!page) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Page not found' });
    return page;
  }

  listBanners(): Promise<unknown[]> {
    return this.repo.listActiveBanners(this.now());
  }

  createBanner(input: {
    title: string;
    imageUrl?: string;
    imageFileId?: string;
    linkUrl?: string;
    sortOrder?: number;
    activeFrom?: string;
    activeTo?: string;
  }): Promise<string> {
    return this.repo.insertBanner({ ...input, sortOrder: input.sortOrder ?? 0 });
  }

  upsertOffer(input: {
    code: string;
    title: string;
    description?: string;
    couponCode?: string;
    bannerUrl?: string;
    bannerFileId?: string;
    validFrom: string;
    validTo: string;
  }): Promise<string> {
    if (new Date(input.validTo).getTime() <= new Date(input.validFrom).getTime()) {
      throw new AppError(ErrorCode.OFFER_INVALID_WINDOW, 422, {
        message: 'Offer validTo must be after validFrom',
      });
    }
    return this.repo.upsertOffer(input);
  }

  listOffers(): Promise<unknown[]> {
    return this.repo.listLiveOffers(this.now());
  }
}
