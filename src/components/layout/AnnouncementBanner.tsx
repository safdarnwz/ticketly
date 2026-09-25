import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info, AlertOctagon } from 'lucide-react';

import { announcementsApi } from '@/lib/api/announcements';
import { cn } from '@/lib/utils';

const STYLES = {
  info: { bg: 'bg-info/10 border-info/30 text-info', icon: Info },
  warning: { bg: 'bg-warning/10 border-warning/30 text-warning', icon: AlertTriangle },
  critical: { bg: 'bg-danger/10 border-danger/30 text-danger', icon: AlertOctagon },
};

export function AnnouncementBanner() {
  const { data } = useQuery({ queryKey: ['active-announcements'], queryFn: announcementsApi.activeForOperators, staleTime: 60_000 });
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-4 pt-3">
      {items.map((a) => {
        const style = STYLES[a.severity];
        const Icon = style.icon;
        return (
          <div key={a.id} className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', style.bg)}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div><b>{a.title}</b> — {a.body}</div>
          </div>
        );
      })}
    </div>
  );
}
