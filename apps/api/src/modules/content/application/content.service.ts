import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { AppError, ErrorCode, getUserId, NotFoundError } from '@kernel';

import { FileService } from '../../files';
import {
  applyPageEdit,
  isValidWindow,
  type AnnouncementAudience,
  type AnnouncementSeverity,
  type PageKind,
  type PageStatus,
} from '../domain/content';
import { AnnouncementRepository } from '../infrastructure/announcement.repository';
import { ContentPageRepository, type ContentPage } from '../infrastructure/content-page.repository';
import { PromoContentRepository } from '../infrastructure/promo-content.repository';

/** Storefront content: pages (incl. legal), banners, offers and announcements. */
@Injectable()
export class ContentService {
  constructor(
    private readonly pages: ContentPageRepository,
    private readonly promo: PromoContentRepository,
    private readonly announcements: AnnouncementRepository,
    private readonly files: FileService,
    private readonly uow: UnitOfWork,
  ) {}

  /* ── pages ── */

  async publishedPage(slug: string): Promise<ContentPage> {
    const page = await this.pages.findPublished(slug);
    if (!page) throw new NotFoundError('Page', slug);
    return page;
  }

  publishedPages(kind?: PageKind): Promise<ContentPage[]> {
    return this.pages.listPublished(kind);
  }

  allPages(): Promise<ContentPage[]> {
    return this.pages.listAll();
  }

  /** Create or edit; the version/effective date moves only when the public version changes. */
  async savePage(
    slug: string,
    edit: { kind?: PageKind; title: string; body: string; status?: PageStatus },
  ): Promise<{ slug: string; version: number; versionBumped: boolean }> {
    return this.uow.run({ name: 'content.savePage' }, async () => {
      const result = applyPageEdit(await this.pages.stateForUpdate(slug), edit);
      if ('error' in result)
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: result.error });
      await this.pages.save(slug, result.next, result.bumped);
      return { slug, version: result.next.version, versionBumped: result.bumped };
    });
  }

  /* ── banners & offers ── */

  async uploadImage(purpose: 'cms_banner' | 'offer_banner', bytes: Buffer, fileName?: string) {
    const f = await this.files.upload({
      purpose,
      bytes,
      fileName,
      sub: [purpose === 'cms_banner' ? 'banners' : 'offers'],
    });
    return { fileId: f.id, url: f.url, fileName: f.fileName, sizeBytes: f.sizeBytes };
  }

  activeBanners() {
    return this.promo.activeBanners(new Date());
  }

  async createBanner(input: {
    title: string;
    imageFileId: string;
    linkUrl?: string;
    sortOrder: number;
    activeFrom?: string;
    activeTo?: string;
  }): Promise<string> {
    if (!isValidWindow(input.activeFrom, input.activeTo))
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'activeTo must be after activeFrom',
      });
    const file = await this.files.requireForPurpose(input.imageFileId, 'cms_banner');
    return this.promo.insertBanner({
      ...input,
      imageFileId: file.id,
      imageUrl: await this.files.urlFor(file),
    });
  }

  async setBannerActive(id: string, isActive: boolean): Promise<void> {
    if (!(await this.promo.setBannerActive(id, isActive))) throw new NotFoundError('Banner', id);
  }

  liveOffers() {
    return this.promo.liveOffers(new Date());
  }

  async saveOffer(input: {
    code: string;
    title: string;
    description?: string;
    couponCode?: string;
    bannerFileId?: string;
    validFrom: string;
    validTo: string;
  }): Promise<string> {
    if (!isValidWindow(input.validFrom, input.validTo))
      throw new AppError(ErrorCode.OFFER_INVALID_WINDOW, 422, {
        message: 'Offer validTo must be after validFrom',
      });
    const file = input.bannerFileId
      ? await this.files.requireForPurpose(input.bannerFileId, 'offer_banner')
      : null;
    return this.promo.upsertOffer({
      ...input,
      bannerFileId: file?.id ?? null,
      bannerUrl: file ? await this.files.urlFor(file) : null,
    });
  }

  /* ── announcements ── */

  activeAnnouncements(audience: Exclude<AnnouncementAudience, 'all'>) {
    return this.announcements.active(audience);
  }

  allAnnouncements() {
    return this.announcements.listAll();
  }

  async createAnnouncement(input: {
    title: string;
    body: string;
    severity: AnnouncementSeverity;
    audience: AnnouncementAudience;
    startsAt?: string;
    endsAt?: string;
  }): Promise<string> {
    if (!isValidWindow(input.startsAt, input.endsAt))
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'endsAt must be after startsAt',
      });
    return this.announcements.create({
      ...input,
      createdBy: getUserId() ?? null,
    });
  }

  async deleteAnnouncement(id: string): Promise<void> {
    if (!(await this.announcements.delete(id))) throw new NotFoundError('Announcement', id);
  }
}
