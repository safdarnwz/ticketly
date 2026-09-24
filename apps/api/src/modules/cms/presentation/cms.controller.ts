import { Body, Controller, Get, Param, Post, HttpCode, Query } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, Public, RequirePermission, RequirePlatformAdmin, zodBody } from '@http';

import { CmsService } from '../application/services/cms.service';
import { FileService } from '../../files/application/file.service';
import { BadRequestError } from '@kernel';

const UpsertPageSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(160),
  body: z.string().max(50000).default(''),
  status: z.enum(['draft', 'published']).default('draft'),
});
const BannerSchema = z.object({
  title: z.string().min(1).max(160),
  /** Id from POST /cms/uploads?purpose=cms_banner — the image itself lives in object storage. */
  imageFileId: z.string().uuid(),
  linkUrl: z.string().url().optional(),
  sortOrder: z.number().int().min(0).max(999).default(0),
  activeFrom: z.string().datetime().optional(),
  activeTo: z.string().datetime().optional(),
});
const OfferSchema = z.object({
  code: z.string().min(1).max(40),
  title: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  couponCode: z.string().max(40).optional(),
  /** Id from POST /cms/uploads?purpose=offer_banner. */
  bannerFileId: z.string().uuid().optional(),
  validFrom: z.string().datetime(),
  validTo: z.string().datetime(),
});

@ApiTags('cms')
@ApiBearerAuth('bearer')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class CmsController {
  constructor(
    private readonly cms: CmsService,
    private readonly files: FileService,
  ) {}

  @Post('cms/uploads')
  @HttpCode(201)
  @RequirePlatformAdmin()
  @ApiOperation({
    summary:
      'Upload a banner/offer image as raw bytes (Content-Type: application/octet-stream). JPG/PNG/WEBP ≤ 5 MB.',
  })
  async upload(
    @Query('purpose') purpose: string,
    @Query('fileName') fileName: string | undefined,
    @Body() body: Buffer,
  ) {
    if (purpose !== 'cms_banner' && purpose !== 'offer_banner')
      throw new BadRequestError("purpose must be 'cms_banner' or 'offer_banner'");
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new BadRequestError(
        'Send the image as raw bytes with Content-Type: application/octet-stream',
      );
    const f = await this.files.upload({
      purpose,
      bytes: body,
      fileName,
      sub: [purpose === 'cms_banner' ? 'banners' : 'offers'],
    });
    return { fileId: f.id, url: f.url, fileName: f.fileName, sizeBytes: f.sizeBytes };
  }

  // ── Public storefront reads ────────────────────────────────────────────
  @Get('content/pages/:slug')
  @Public()
  @ApiOperation({ summary: 'Get a published content page by slug' })
  async page(@Param('slug') slug: string) {
    return this.cms.getPage(slug);
  }

  @Get('content/banners')
  @Public()
  @ApiOperation({ summary: 'Active storefront banners' })
  async banners() {
    return { banners: await this.cms.listBanners() };
  }

  @Get('content/offers')
  @Public()
  @ApiOperation({ summary: 'Live promotional offers' })
  async offers() {
    return { offers: await this.cms.listOffers() };
  }

  // ── Operator management ────────────────────────────────────────────────
  @Post('content/pages')
  @HttpCode(200)
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Create/update a content page' })
  async upsertPage(@Body(zodBody(UpsertPageSchema)) dto: z.infer<typeof UpsertPageSchema>) {
    return { id: await this.cms.upsertPage(dto) };
  }

  @Post('content/banners')
  @HttpCode(201)
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Create a storefront banner' })
  async createBanner(@Body(zodBody(BannerSchema)) dto: z.infer<typeof BannerSchema>) {
    const file = await this.files.requireForPurpose(dto.imageFileId, 'cms_banner');
    const { imageFileId: _f, ...rest } = dto;
    void _f;
    return {
      id: await this.cms.createBanner({
        ...rest,
        imageUrl: (await this.files.urlFor(file)) ?? undefined,
        imageFileId: file.id,
      }),
    };
  }

  @Post('content/offers')
  @HttpCode(200)
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Create/update a promotional offer' })
  async upsertOffer(@Body(zodBody(OfferSchema)) dto: z.infer<typeof OfferSchema>) {
    const file = dto.bannerFileId
      ? await this.files.requireForPurpose(dto.bannerFileId, 'offer_banner')
      : null;
    const { bannerFileId: _f, ...rest } = dto;
    void _f;
    return {
      id: await this.cms.upsertOffer({
        ...rest,
        bannerUrl: file ? ((await this.files.urlFor(file)) ?? undefined) : undefined,
        bannerFileId: file?.id,
      }),
    };
  }
}
