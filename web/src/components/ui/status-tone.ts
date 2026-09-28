export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

/** Maps common backend statuses to a tone so badges are consistent app-wide. */
export function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (['confirmed', 'settled', 'processed', 'published', 'active', 'resolved', 'allow', 'paid'].includes(s)) return 'success';
  if (['held', 'pending', 'processing', 'review', 'draft', 'open'].includes(s)) return 'warning';
  if (['cancelled', 'failed', 'deny', 'expired', 'closed', 'rejected'].includes(s)) return 'danger';
  if (['completed', 'confirmed'].includes(s)) return 'info';
  return 'neutral';
}
