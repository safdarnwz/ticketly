/**
 * Storefront content — pages (incl. the platform's legal pages), banners,
 * offers and announcements. All platform-wide: www.ticketly.com is one
 * storefront for every operator.
 */
export const PageKind = { PAGE: 'page', LEGAL: 'legal' } as const;
export type PageKind = (typeof PageKind)[keyof typeof PageKind];

export const PageStatus = { DRAFT: 'draft', PUBLISHED: 'published' } as const;
export type PageStatus = (typeof PageStatus)[keyof typeof PageStatus];

export const AnnouncementSeverity = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
} as const;
export type AnnouncementSeverity = (typeof AnnouncementSeverity)[keyof typeof AnnouncementSeverity];

export const AnnouncementAudience = {
  OPERATORS: 'operators',
  CUSTOMERS: 'customers',
  ALL: 'all',
} as const;
export type AnnouncementAudience = (typeof AnnouncementAudience)[keyof typeof AnnouncementAudience];

/** Display order: most severe first. */
export const SEVERITY_RANK: Record<AnnouncementSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

export interface PageState {
  kind: PageKind;
  title: string;
  body: string;
  status: PageStatus;
  version: number;
}

/**
 * Apply an edit to a page. The version (and effective date) moves only when
 * what the public can read changes: a published page's title/body edited, or
 * a draft being published. Draft edits don't count — nobody could see them.
 * Legal pages can never be drafts (the Terms must always be readable).
 */
export function applyPageEdit(
  current: PageState | null,
  edit: { kind?: PageKind; title: string; body: string; status?: PageStatus },
): { next: PageState; bumped: boolean } | { error: string } {
  const kind = current?.kind ?? edit.kind ?? PageKind.PAGE;
  if (current && edit.kind && edit.kind !== current.kind)
    return { error: 'A page cannot change kind' };
  const status =
    kind === PageKind.LEGAL
      ? PageStatus.PUBLISHED
      : (edit.status ?? current?.status ?? PageStatus.DRAFT);
  if (kind === PageKind.LEGAL && edit.status === PageStatus.DRAFT)
    return { error: 'Legal pages cannot be unpublished' };
  if (!current)
    return {
      next: { kind, title: edit.title, body: edit.body, status, version: 1 },
      bumped: false,
    };

  const visibleChange =
    status === PageStatus.PUBLISHED &&
    (current.status !== PageStatus.PUBLISHED ||
      current.title !== edit.title ||
      current.body !== edit.body);
  return {
    next: {
      kind,
      title: edit.title,
      body: edit.body,
      status,
      version: current.version + (visibleChange ? 1 : 0),
    },
    bumped: visibleChange,
  };
}

/** An offer or banner window: end must be after start. */
export function isValidWindow(from: string | undefined, to: string | undefined): boolean {
  if (!from || !to) return true;
  return Date.parse(to) > Date.parse(from);
}
