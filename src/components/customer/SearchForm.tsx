import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, ArrowUpDown, CalendarDays, Search } from 'lucide-react';

import { Button } from '@/components/ui';
import { CityInput } from '@/components/customer/CityInput';
import { DateStrip } from '@/components/customer/DateStrip';
import { useBooking } from '@/stores/booking';
import { addDaysIso, cn, formatDateLabel, todayLocal } from '@/lib/utils';
import { resultsUrl } from '@/lib/search-filters';
import { saveRecent } from '@/lib/recent-searches';

/** How far ahead the date pickers allow (operators open sales up to ~120 days out). */
const MAX_DAYS_AHEAD = 120;

/**
 * One search form for the home page and the results page ("modify search").
 * Validates what the backend would refuse anyway, so the customer sees it
 * before a round-trip: both cities chosen, not the same city, no past date,
 * return not before onward.
 *
 * Home (default): the journey card — From / Destination with ring dots and big
 * city names, a round search button, and "Pick a date" day cards.
 * `compact` (results page): the same fields in one row.
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

  // A recent-trip card on the home page sets the journey date in the store.
  useEffect(() => {
    if (b.journeyDate && b.journeyDate >= today) setDate(b.journeyDate);
  }, [b.journeyDate, today]);

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
    saveRecent({ from: { id: b.originCityId, name: b.originLabel }, to: { id: b.destCityId, name: b.destLabel }, date });
    navigate(resultsUrl(b.originLabel, b.destLabel, date, roundTrip ? returnDate : undefined));
    onDone?.();
  };

  const pickDate = (v: string) => {
    setDate(v);
    if (returnDate < v) setReturnDate(v);
    setErrors((x) => ({ ...x, date: '' }));
  };

  const tripType = (
    <div className="inline-flex rounded-pill bg-surface-muted p-1 text-sm" role="group" aria-label="Trip type">
      {(['one-way', 'round-trip'] as const).map((k) => (
        <button
          key={k}
          type="button"
          aria-pressed={(k === 'round-trip') === roundTrip}
          onClick={() => setRoundTrip(k === 'round-trip')}
          className={cn(
            'rounded-pill px-3.5 py-1 font-semibold transition',
            (k === 'round-trip') === roundTrip ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
          )}
        >
          {k === 'one-way' ? 'One way' : 'Round trip'}
        </button>
      ))}
    </div>
  );

  const fromInput = (variant: 'field' | 'journey') => (
    <CityInput
      variant={variant}
      label="From"
      value={b.originLabel}
      error={errors.from}
      placeholder={variant === 'journey' ? 'Leaving from' : 'City'}
      onSelect={(c) => { b.setSearch({ originCityId: c.id, originLabel: c.name }); setErrors((e) => ({ ...e, from: '', to: '' })); }}
      onClear={() => b.setSearch({ originCityId: '' })}
    />
  );
  const toInput = (variant: 'field' | 'journey') => (
    <CityInput
      variant={variant}
      label={variant === 'journey' ? 'Destination' : 'To'}
      value={b.destLabel}
      error={errors.to}
      placeholder={variant === 'journey' ? 'Going to' : 'City'}
      onSelect={(c) => { b.setSearch({ destCityId: c.id, destLabel: c.name }); setErrors((e) => ({ ...e, to: '' })); }}
      onClear={() => b.setSearch({ destCityId: '' })}
    />
  );

  if (!compact) {
    return (
      <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-6">
        <div className="relative">
          <div>
            {fromInput('journey')}
            <div className="flex items-center gap-3 py-1.5">
              <span className="flex w-3 justify-center self-stretch"><span className="dot-line h-full min-h-[28px]" /></span>
              <div className="h-px flex-1 bg-border" />
              <button
                type="button"
                onClick={swap}
                aria-label="Swap cities"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted text-text-muted hover:bg-border hover:text-text"
              >
                <ArrowUpDown className="h-4 w-4" />
              </button>
            </div>
            {toInput('journey')}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {tripType}
        </div>

        <DateStrip label="Pick a date" value={date} min={today} max={maxDate} onChange={pickDate} error={errors.date} />
        {roundTrip && (
          <DateStrip
            label="Return date"
            value={returnDate}
            min={date || today}
            max={maxDate}
            days={14}
            onChange={(v) => { setReturnDate(v); setErrors((x) => ({ ...x, returnDate: '' })); }}
            error={errors.returnDate}
          />
        )}

        <Button type="submit" size="lg" fullWidth leftIcon={<Search className="h-4 w-4" />}>
          Search buses
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="mb-3">{tripType}</div>
      <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-start">
        {fromInput('field')}
        <button
          type="button"
          onClick={swap}
          className="mx-auto -my-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-text-muted hover:bg-border lg:mx-0 lg:mt-8"
          aria-label="Swap cities"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </button>
        {toInput('field')}
        <div className="w-full lg:w-44">
          <label className="mb-1.5 block text-sm font-medium text-text" htmlFor="journey-date">Date</label>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              id="journey-date"
              type="date"
              value={date}
              min={today}
              max={maxDate}
              onChange={(e) => pickDate(e.target.value)}
              className={cn('h-12 w-full rounded-input border bg-surface pl-9 pr-2 text-sm text-text focus-ring', errors.date ? 'border-danger' : 'border-border')}
            />
          </div>
          {errors.date && <p className="mt-1 text-xs text-danger">{errors.date}</p>}
        </div>
        {roundTrip && (
          <div className="w-full lg:w-44">
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
        <Button type="submit" size="lg" leftIcon={<Search className="h-4 w-4" />} className="w-full lg:mt-7 lg:w-auto">
          Search buses
        </Button>
      </div>
    </form>
  );
}
