import { get } from './client';

export interface LegalPage {
  slug: string;
  title: string;
  bodyMd: string;
  version: number;
  effectiveFrom: string;
  updatedAt: string;
}

export const legalApi = {
  page: (slug: string) => get<LegalPage>(`/v1/legal/${slug}`),
};
