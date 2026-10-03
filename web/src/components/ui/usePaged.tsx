import { useEffect, useRef, useState } from 'react';

import { Pager } from './Pager';
import { PAGE_SIZE } from './paging';

/**
 * A long list shown ten at a time. A new list (another filter) starts again at
 * page 1, and the page never sits past the last one. With `more`, a list that
 * loads further items as it goes fetches them when Next reaches its end.
 */
export function usePaged<T>(
  items: readonly T[],
  opts: { pageSize?: number; more?: { hasMore: boolean; loading?: boolean; onMore: () => void } } = {},
) {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const more = opts.more;
  const [page, setPage] = useState(1);
  const first = useRef<T | undefined>(items[0]);
  useEffect(() => {
    if (items[0] !== first.current) setPage(1);
    first.current = items[0];
  }, [items]);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages);
  const goTo = (p: number) => {
    if (more && p > pages) more.onMore();
    setPage(p);
  };
  return {
    page: current,
    pageItems: items.slice((current - 1) * pageSize, current * pageSize),
    pager:
      items.length > pageSize || more?.hasMore ? (
        <Pager
          page={current}
          pageSize={pageSize}
          total={more?.hasMore ? undefined : items.length}
          hasNext={current < pages || !!more?.hasMore}
          loading={more?.loading}
          onPage={goTo}
        />
      ) : null,
  };
}
