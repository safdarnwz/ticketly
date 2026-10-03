import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

import { PAGE_SIZE } from './paging';

/**
 * "11–20 of 57" and Previous / Next. `total` may be unknown (a server list that
 * only says whether there is more): then it reads "Page 3".
 */
export function Pager({
  page,
  pageSize = PAGE_SIZE,
  total,
  hasNext,
  loading,
  onPage,
  className,
}: {
  /** 1-based. */
  page: number;
  pageSize?: number;
  total?: number;
  hasNext: boolean;
  loading?: boolean;
  onPage: (page: number) => void;
  className?: string;
}) {
  const from = (page - 1) * pageSize + 1;
  const to = total !== undefined ? Math.min(total, page * pageSize) : undefined;
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : undefined;
  return (
    <nav aria-label="Pages" className={cn('mt-3 flex flex-wrap items-center justify-between gap-2 text-sm', className)}>
      <span className="text-text-muted">
        {total !== undefined ? (total === 0 ? 'Nothing to show' : `${from}–${to} of ${total}`) : `Page ${page}`}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1 || loading}
          aria-label="Previous page"
          className="flex h-9 items-center gap-1 rounded-btn border border-border bg-surface px-3 text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </button>
        {pages !== undefined && (
          <span className="px-2 text-text-muted">
            {page} / {pages}
          </span>
        )}
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={!hasNext || loading}
          aria-label="Next page"
          className="flex h-9 items-center gap-1 rounded-btn border border-border bg-surface px-3 text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
