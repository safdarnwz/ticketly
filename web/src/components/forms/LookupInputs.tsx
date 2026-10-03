import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Landmark, Loader2, MapPin } from 'lucide-react';

import { Input } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { IFSC_RE, PINCODE_RE, lookupsApi, type IfscInfo, type PincodeInfo } from '@/lib/api/lookups';

/** "Not found" reads better as what it means for the form; anything else keeps the API's message. */
const errText = (e: unknown, notFound: string) =>
  e instanceof ApiError && e.status === 404 ? notFound : e instanceof Error ? e.message : notFound;

/**
 * PIN code field. Once six digits are typed it looks the PIN up and hands the
 * city, state and localities to `onResolved` (once per PIN) so the form can
 * fill them; under the field it shows where the PIN is — or that no post
 * office has it.
 */
export function PincodeInput({
  value,
  onChange,
  onResolved,
  error,
  label = 'PIN code',
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onResolved?: (info: PincodeInfo) => void;
  error?: string;
  label?: string;
  disabled?: boolean;
}) {
  const pin = value.trim();
  const ready = PINCODE_RE.test(pin);
  const q = useQuery({
    queryKey: ['lookup-pincode', pin],
    queryFn: () => lookupsApi.pincode(pin),
    enabled: ready,
    staleTime: Infinity,
    retry: false,
  });
  const handed = useRef<string | null>(null);
  useEffect(() => {
    if (q.data && handed.current !== q.data.pincode) {
      handed.current = q.data.pincode;
      onResolved?.(q.data);
    }
  }, [q.data, onResolved]);

  const lookupError = ready && q.isError ? errText(q.error, 'No post office has this PIN code') : undefined;
  const notYet = pin.length > 0 && !ready ? (pin.length === 6 ? 'A PIN code is 6 digits and does not start with 0' : undefined) : undefined;
  return (
    <div className="flex flex-col gap-1">
      <Input
        label={label}
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={6}
        value={value}
        disabled={disabled}
        leftIcon={<MapPin className="h-4 w-4" />}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        error={error ?? lookupError ?? notYet}
        placeholder="6 digits"
      />
      {ready && !error && (q.isFetching ? (
        <span className="flex items-center gap-1 text-xs text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> Finding the city…</span>
      ) : q.data ? (
        <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3 w-3" /> {q.data.city}, {q.data.state}</span>
      ) : null)}
    </div>
  );
}

/**
 * IFSC field. Once 11 characters are typed it looks the code up: the bank (and
 * branch, when known) shows under the field and goes to `onResolved` so the
 * form can fill the bank name; an IFSC no branch has is flagged at once.
 */
export function IfscInput({
  value,
  onChange,
  onResolved,
  error,
  label = 'IFSC code',
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onResolved?: (info: IfscInfo) => void;
  error?: string;
  label?: string;
  disabled?: boolean;
}) {
  const code = value.trim().toUpperCase();
  const ready = IFSC_RE.test(code);
  const q = useQuery({
    queryKey: ['lookup-ifsc', code],
    queryFn: () => lookupsApi.ifsc(code),
    enabled: ready,
    staleTime: Infinity,
    retry: false,
  });
  const handed = useRef<string | null>(null);
  useEffect(() => {
    if (q.data && handed.current !== q.data.ifsc) {
      handed.current = q.data.ifsc;
      onResolved?.(q.data);
    }
  }, [q.data, onResolved]);

  const lookupError = ready && q.isError ? errText(q.error, 'No bank branch has this IFSC — check it on the cheque book') : undefined;
  const shape = code.length === 11 && !ready ? 'An IFSC is 11 characters, like HDFC0001234' : undefined;
  return (
    <div className="flex flex-col gap-1">
      <Input
        label={label}
        autoCapitalize="characters"
        maxLength={11}
        value={value}
        disabled={disabled}
        leftIcon={<Landmark className="h-4 w-4" />}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))}
        error={error ?? lookupError ?? shape}
        placeholder="HDFC0001234"
      />
      {ready && !error && (q.isFetching ? (
        <span className="flex items-center gap-1 text-xs text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> Finding the bank…</span>
      ) : q.data ? (
        <span className="flex items-center gap-1 text-xs text-success">
          <CheckCircle2 className="h-3 w-3 shrink-0" />
          {q.data.bank}{q.data.branch ? ` · ${q.data.branch}` : ''}{q.data.city ? `, ${q.data.city}` : ''}
        </span>
      ) : null)}
    </div>
  );
}
