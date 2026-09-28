import { get } from './client';

export interface LegalPage {
  slug: string;
  kind?: string;
  title: string;
  /** Markdown. */
  body: string;
  version: number;
  effectiveFrom: string;
  updatedAt: string;
}

export const legalApi = {
  page: (slug: string) => get<LegalPage>(`/v1/content/pages/${slug}`),
  list: () => get<{ items: LegalPage[] }>('/v1/content/pages?kind=legal'),
};
