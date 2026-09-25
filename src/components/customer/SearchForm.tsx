import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, CalendarDays, History, Search, X } from 'lucide-react';

import { Button } from '@/components/ui';
import { CityInput } from '@/components/customer/CityInput';
import { useBooking } from '@/stores/booking';
import { addDaysIso, cn, formatDateLabel, todayLocal } from '@/lib/utils';
import { resultsUrl } from '@/lib/search-filters';

interface Place { id: string; name: string }
interface Recent { from: Place; to: Place }

const RECENT_KEY = 'ticketly.recentSearches';
/** How far ahead the date pickers allow (operators open sales up to ~120 days out). */
const MAX_DAYS_AHEAD = 120;

function readRecent(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Recent[];
    return Array.isArray(v) ? v.filter((r) => r?.from?.id && r?.to?.id).slice(0, 5) : [];
  } catch {
    return [];
  }
}
function saveRecent(r: Recent): void {
  try {
    const rest = readRecent().filter((x) => !(x.from.id === r.from.id && x.to.id === r.to.id));
    localStorage.setItem(RECENT_KEY, JSON.stringify([r, ...rest].slice(0, 5)));
  } catch {
    /* private mode / storage blocked — recent searches are a convenience only */
  }
}


/**
 * One search form for the home page and the results page ("modify search").
 * Validates what the backend would refuse anyway, so the customer sees it
 * before a round-trip: both cities chosen, not the same city, no past date,
 * return not before onward.
 */
export function SearchForm({ compact, initialReturnDate, onDone }: {
  compact?: boolean;
  initialReturnDate?: string;
  onDone?: () => void;
}) {
  const navigate = useNavigate();
  const b = useBooking();
  const today = todayLocal();
  const maxDate = addDaysIso(today, MAX_DAYS_AHEAD);
  const [date, setDate] = useState(b.journeyDate < today ? today : b.journeyDate);
  const [roundTrip, setRoundTrip] = useState(Boolean(initialReturnDate));
  const [returnDate, setReturnDate] = useState(initialReturnDate ?? addDaysIso(date, 1));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recent, setRecent] = useState<Recent[]>(readRecent);

  const swap = () => {
    b.setSearch({
      originCityId: b.destCityId, originLabel: b.destLabel,
      destCityId: b.originCityId, destLabel: b.originLabel,
    });
    setErrors({});
  };

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!b.originCityId) e.from = 'Choose where you are leaving from';
    if (!b.destCityId) e.to = 'Choose where you are going';
    if (b.originCityId && b.originCityId === b.destCityId) e.to = 'Pick a different city from where you leave';
    if (!date || date < today) e.date = 'Pick today or a later date';
    else if (date > maxDate) e.date = `Tickets open up to ${formatDateLabel(maxDate)}`;
    if (roundTrip) {
      if (!returnDate || returnDate < date) e.returnDate = 'Return must be on or after the onward date';
      else if (returnDate > maxDate) e.returnDate = `Tickets open up to ${formatDateLabel(maxDate)}`;
    }
    return e;
  };

  const submit = (ev?: FormEvent) => {
    ev?.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    b.setSearch({ journeyDate: date });
    saveRecent({ from: { id: b.originCityId, name: b.originLabel }, to: { id: b.destCityId, name: b.destLabel } });
    setRecent(readRecent());
    navigate(resultsUrl(b.originLabel, b.destLabel, date, roundTrip ? returnDate : undefined));
    onDone?.();
  };

  const applyRecent = (r: Recent) => {
    b.setSearch({ originCityId: r.from.id, originLabel: r.from.name, destCityId: r.to.id, destLabel: r.to.name });
    setErrors({});
  };

  const dateChip = (label: string, value: string) => (
    <button
      type="button"
      onClick={() => { setDate(value); setErrors((e) => ({ ...e, date: '' })); }}
      className={cn(
        'rounded-pill border px-2.5 py-0.5 text-xs font-medium transition',
        date === value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-text-muted hover:bg-surface-muted',
      )}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={submit} noValidate>
      <div className="mb-3 flex items-center gap-2 text-sm">
        {(['one-way', 'round-trip'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setRoundTrip(k === 'round-trip')}
            className={cn(
              'rounded-pill px-3 py-1 font-medium transition',
              (k === 'round-trip') === roundTrip ? 'bg-primary text-primary-fg' : 'text-text-muted hover:bg-surface-muted',
            )}
          >
            {k === 'one-way' ? 'One way' : 'Round trip'}
          </button>
        ))}
      </div>

      <div className={cn('flex flex-col items-stretch gap-3', compact ? 'lg:flex-row lg:items-start' : 'md:flex-row md:items-start')}>
        <CityInput
          label="From"
          value={b.originLabel}
          error={errors.from}
          onSelect={(c) => { b.setSearch({ originCityId: c.id, originLabel: c.name }); setErrors((e) => ({ ...e, from: '', to: '' })); }}
          onClear={() => b.setSearch({ originCityId: '' })}
        />
        <button
          type="button"
          onClick={swap}
          className="mx-auto -my-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text-muted hover:bg-surface-muted md:mx-0 md:mt-8"
          aria-label="Swap cities"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </button>
        <CityInput
          label="To"
          value={b.destLabel}
          error={errors.to}
          onSelect={(c) => { b.setSearch({ destCityId: c.id, destLabel: c.name }); setErrors((e) => ({ ...e, to: '' })); }}
          onClear={() => b.setSearch({ destCityId: '' })}
        />
        <div className="w-full md:w-44">
          <label className="mb-1.5 block text-sm font-medium text-text" htmlFor="journey-date">Date</label>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              id="journey-date"
              type="date"
              value={date}
              min={today}
              max={maxDate}
              onChange={(e) => {
                setDate(e.target.value);
                if (returnDate < e.target.value) setReturnDate(e.target.value);
                setErrors((x) => ({ ...x, date: '' }));
              }}
              className={cn('h-12 w-full rounded-input border bg-surface pl-9 pr-2 text-sm text-text focus-ring', errors.date ? 'border-danger' : 'border-border')}
            />
          </div>
          {errors.date ? <p className="mt-1 text-xs text-danger">{errors.date}</p> : (
            <div className="mt-1.5 flex gap-1.5">{dateChip('Today', today)}{dateChip('Tomorrow', addDaysIso(today, 1))}</div>
          )}
        </div>
        {roundTrip && (
          <div className="w-full md:w-44">
            <label className="mb-1.5 block text-sm font-medium text-text" htmlFor="return-date">Return</label>
            <input
              id="return-date"
              type="date"
              value={returnDate}
              min={date}
              max={maxDate}
              onChange={(e) => { setReturnDate(e.target.value); setErrors((x) => ({ ...x, returnDate: '' })); }}
              className={cn('h-12 w-full rounded-input border bg-surface px-3 text-sm text-text focus-ring', errors.returnDate ? 'border-danger' : 'border-border')}
            />
            {errors.returnDate && <p className="mt-1 text-xs text-danger">{errors.returnDate}</p>}
          </div>
        )}
        <Button type="submit" size="lg" leftIcon={<Search className="h-4 w-4" />} className="w-full md:mt-7 md:w-auto">
          Search buses
        </Button>
      </div>

      {!compact && recent.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <History className="h-3.5 w-3.5" /> Recent:
          {recent.map((r) => (
            <button
              key={`${r.from.id}-${r.to.id}`}
              type="button"
              onClick={() => applyRecent(r)}
              className="rounded-pill border border-border px-2.5 py-1 text-text hover:bg-surface-muted"
            >
              {r.from.name} → {r.to.name}
            </button>
          ))}
          <button
            type="button"
            aria-label="Clear recent searches"
            onClick={() => { try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } setRecent([]); }}
            className="rounded-full p-1 hover:bg-surface-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </form>
  );
}
