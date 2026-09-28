import { get, patch, post } from './client';

/** What a state's government rule is about. */
export const STATE_NORM_CATEGORIES = [
  { value: 'liquor', label: 'Liquor' },
  { value: 'smoking', label: 'Smoking' },
  { value: 'tobacco', label: 'Tobacco / gutkha' },
  { value: 'plastic', label: 'Plastic' },
  { value: 'pets', label: 'Pets / animals' },
  { value: 'luggage', label: 'Luggage / goods' },
  { value: 'documents', label: 'ID & documents' },
  { value: 'other', label: 'Other' },
] as const;
export type StateNormCategory = (typeof STATE_NORM_CATEGORIES)[number]['value'];
export const categoryLabel = (c: string) => STATE_NORM_CATEGORIES.find((x) => x.value === c)?.label ?? c;

export interface StateNorm {
  id: string; stateId: string; stateName: string; category: StateNormCategory;
  title: string; body: string; isActive: boolean; updatedAt: string;
}
/** A state on a route with the rules it brings — the operator cannot drop any. */
export interface StateRules { stateId: string; stateName: string; norms: Pick<StateNorm, 'id' | 'category' | 'title' | 'body'>[] }

/** Platform admin: each state's government rules. */
export const stateNormsAdminApi = {
  states: () => get<{ items: { id: string; code: string; name: string }[] }>('/v1/admin/state-norms/states'),
  list: (stateId?: string, includeInactive = true) =>
    get<{ items: StateNorm[] }>(`/v1/admin/state-norms?${new URLSearchParams({ ...(stateId ? { stateId } : {}), includeInactive: String(includeInactive) })}`),
  create: (body: { stateId: string; category: StateNormCategory; title: string; body: string }) => post<StateNorm>('/v1/admin/state-norms', body),
  update: (id: string, body: Partial<{ category: StateNormCategory; title: string; body: string; isActive: boolean }>) =>
    patch<StateNorm>(`/v1/admin/state-norms/${id}`, body),
};

/** Operator: the rules a route carries. */
export const stateNormsApi = {
  forRoute: (routeId: string) => get<{ states: StateRules[] }>(`/v1/master-data/routes/${routeId}/state-norms`),
  forCities: (cityIds: string[]) => get<{ states: StateRules[] }>(`/v1/master-data/state-norms?cityIds=${cityIds.join(',')}`),
};
