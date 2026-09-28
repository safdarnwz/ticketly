import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Counts down to the seat-hold expiry; calls onExpire once when it reaches zero. */
export function HoldTimer({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }) {
  const end = Date.parse(expiresAt);
  const [left, setLeft] = useState(() => Math.max(0, end - Date.now()));
  useEffect(() => {
    const t = setInterval(() => {
      const v = Math.max(0, end - Date.now());
      setLeft(v);
      if (v === 0) {
        clearInterval(t);
        onExpire();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [end, onExpire]);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <div
      role="timer"
      aria-live="off"
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
        left < 120_000 ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning',
      )}
    >
      <Timer className="h-4 w-4" />
      Seats held for {m}:{String(s).padStart(2, '0')}
    </div>
  );
}
