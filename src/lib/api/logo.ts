import { get, patch } from './client';

export const logoApi = {
  get: () => get<{ dataUri: string | null }>('/v1/operator/logo'),
  set: (dataUri: string) => patch<{ ok: boolean }>('/v1/operator/logo', { dataUri }),
};

export const invoicePrefixApi = {
  get: () => get<{ prefix: string; isCustom: boolean }>('/v1/operator/invoice-prefix'),
  set: (prefix: string) => patch<{ ok: boolean }>('/v1/operator/invoice-prefix', { prefix }),
};
