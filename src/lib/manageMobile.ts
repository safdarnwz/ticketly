/** The booking mobile a guest proved ownership with on Manage booking — kept for this tab only, never in the URL. */
const key = (bookingId: string) => `manage-mobile:${bookingId}`;

export function rememberManageMobile(bookingId: string, mobile: string): void {
  try { sessionStorage.setItem(key(bookingId), mobile); } catch { /* private mode: the page asks again */ }
}

export function recalledMobile(bookingId: string): string | undefined {
  try { return sessionStorage.getItem(key(bookingId)) ?? undefined; } catch { return undefined; }
}
