import { useEffect, useId, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    // Phones: a sheet rising from the bottom; larger screens: a centred dialog.
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-text/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn('relative w-full rounded-t-[28px] bg-surface pb-[env(safe-area-inset-bottom)] sm:rounded-[var(--yb-modal-radius)] sm:pb-0', sizes[size])}
        style={{ boxShadow: 'var(--yb-modal-shadow)' }}
      >
        <span aria-hidden className="mx-auto mt-2 block h-1.5 w-10 rounded-pill bg-border sm:hidden" />
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 id={titleId} className="font-display text-base text-text">{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-text-muted hover:bg-surface-muted focus-ring">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-auto p-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4">{footer}</div>}
      </div>
    </div>
  );
}
