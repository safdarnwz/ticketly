import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info, AlertOctagon, X } from 'lucide-react';

import { announcementsApi } from '@/lib/api/announcements';
import { cn } from '@/lib/utils';

const STYLES = {
  info: { bg: 'bg-info/10 border-info/30 text-info', icon: Info },
  warning: { bg: 'bg-warning/10 border-warning/30 text-warning', icon: AlertTriangle },
  critical: { bg: 'bg-danger/10 border-danger/30 text-danger', icon: AlertOctagon },
};

const DISMISSED_KEY = 'ticketly.dismissedAnnouncements';
function readDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/**
 * Live platform announcements for the operator console or the storefront.
 * Info / warning notices can be closed for this browser session; critical
 * ones always stay.
 */
export function AnnouncementBanner({ audience = 'operators', className }: { audience?: 'operators' | 'customers'; className?: string }) {
  const { data } = useQuery({
    queryKey: ['active-announcements', audience],
    queryFn: audience === 'customers' ? announcementsApi.activeForCustomers : announcementsApi.activeForOperators,
    staleTime: 60_000,
  });
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const items = (data?.items ?? []).filter((a) => a.severity === 'critical' || !dismissed.includes(a.id));
  if (items.length === 0) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try { sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  };

  return (
    <div className={cn('flex flex-col gap-1 px-4 pt-3', className)}>
      {items.map((a) => {
        const style = STYLES[a.severity] ?? STYLES.info;
        const Icon = style.icon;
        return (
          <div key={a.id} role={a.severity === 'critical' ? 'alert' : 'status'} className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', style.bg)}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1"><b>{a.title}</b> — {a.body}</div>
            {a.severity !== 'critical' && (
              <button type="button" onClick={() => dismiss(a.id)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-black/5">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
