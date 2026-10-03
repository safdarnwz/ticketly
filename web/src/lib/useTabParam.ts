import { useSearchParams } from 'react-router-dom';

/**
 * A page's sub-menu choice, kept in the address (`?tab=…`): each tab is its own
 * screen — it can be linked, reloaded and left with Back. Other query values
 * (filters, dates) are kept; the default tab leaves the address clean. Nested
 * menus use their own parameter name.
 */
export function useTabParam<K extends string>(keys: readonly K[], fallback: K, param = 'tab'): [K, (key: K) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(param);
  const tab = raw && (keys as readonly string[]).includes(raw) ? (raw as K) : fallback;
  const setTab = (key: K) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (key === fallback) next.delete(param);
      else next.set(param, key);
      return next;
    });
  return [tab, setTab];
}
