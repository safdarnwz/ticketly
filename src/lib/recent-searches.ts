/**
 * The customer's recent searches, kept in this browser only (a convenience —
 * storage can be blocked or empty, so every read and write is guarded).
 */
export interface Place { id: string; name: string }
export interface RecentSearch { from: Place; to: Place; date?: string }

const RECENT_KEY = 'ticketly.recentSearches';

export function readRecent(): RecentSearch[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as RecentSearch[];
    return Array.isArray(v) ? v.filter((r) => r?.from?.id && r?.to?.id).slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function saveRecent(r: RecentSearch): void {
  try {
    const rest = readRecent().filter((x) => !(x.from.id === r.from.id && x.to.id === r.to.id));
    localStorage.setItem(RECENT_KEY, JSON.stringify([r, ...rest].slice(0, 6)));
    window.dispatchEvent(new Event('ticketly:recent'));
  } catch {
    /* private mode / storage blocked */
  }
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
    window.dispatchEvent(new Event('ticketly:recent'));
  } catch {
    /* ignore */
  }
}
