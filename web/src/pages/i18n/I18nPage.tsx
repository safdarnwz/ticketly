import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowRightLeft, Coins, Languages } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Input, Select, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { i18nApi } from '@/lib/api/platform';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AED'].map((c) => ({ label: c, value: c }));

export function I18nPage() {
  const toast = useToast();
  const [amount, setAmount] = useState('1000');
  const [from, setFrom] = useState('INR');
  const [to, setTo] = useState('USD');
  const [out, setOut] = useState<{ amountMinor: number; formatted: string } | null>(null);

  const convert = useMutation({
    mutationFn: () => i18nApi.convert(Number(amount) * 100, from, to),
    onSuccess: (r) => setOut(r),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'No rate available'),
  });

  return (
    <>
      <PageHeader title="i18n & Currency" subtitle="Currencies and their rates, language packs, and a converter to check them" />
      <div className="grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
        <RateCard />
        <TranslationCard />
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><ArrowRightLeft className="h-4 w-4" /> Currency converter</span>} />
          <CardBody className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <Input label="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Select label="From" value={from} onChange={(e) => setFrom(e.target.value)} options={CURRENCIES} />
              <Select label="To" value={to} onChange={(e) => setTo(e.target.value)} options={CURRENCIES} />
            </div>
            <Button onClick={() => convert.mutate()} loading={convert.isPending}>Convert</Button>
            {out && (
              <div className="rounded-md border border-border bg-surface-muted p-4 text-center">
                <div className="text-2xl font-semibold text-text">{out.formatted}</div>
                <div className="text-xs text-text-muted">{out.amountMinor} minor units</div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const CODE = /^[A-Z]{3}$/;

/** Add a currency or refresh its rate (#83–#85): 1 base = rate quote, with where the rate came from. */
function RateCard() {
  const toast = useToast();
  const [f, setF] = useState({ base: 'INR', quote: 'USD', rate: '', source: 'RBI reference rate' });
  const [tried, setTried] = useState(false);
  const rate = Number(f.rate);
  const e = {
    base: !CODE.test(f.base) ? '3-letter code' : undefined,
    quote: !CODE.test(f.quote) ? '3-letter code' : f.quote === f.base ? 'A different currency' : undefined,
    rate: !(rate > 0) ? 'More than 0' : undefined,
  };
  const save = useMutation({
    mutationFn: () => i18nApi.upsertRate(f.base, f.quote, Math.round(rate * 1e6), new Date().toISOString()),
    onSuccess: () => { toast.success(`1 ${f.base} = ${f.rate} ${f.quote} from now (${f.source || 'manual'})`); setF({ ...f, rate: '' }); setTried(false); },
    onError: (x) => toast.error(errText(x, 'Could not save the rate')),
  });
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Coins className="h-4 w-4" /> Exchange rate</span>} subtitle="A new currency is added the first time it gets a rate" />
      <CardBody className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-3 gap-3">
          <Input label="1 of" value={f.base} maxLength={3} error={tried ? e.base : undefined} onChange={(x) => setF({ ...f, base: x.target.value.toUpperCase() })} />
          <Input label="In" value={f.quote} maxLength={3} error={tried ? e.quote : undefined} onChange={(x) => setF({ ...f, quote: x.target.value.toUpperCase() })} />
          <Input label="Rate" type="number" step="any" value={f.rate} error={tried ? e.rate : undefined} onChange={(x) => setF({ ...f, rate: x.target.value })} placeholder="0.012" />
        </div>
        <Input label="Source (for your records)" value={f.source} onChange={(x) => setF({ ...f, source: x.target.value })} />
        <Button className="self-start" loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); if (!e.base && !e.quote && !e.rate) save.mutate(); }}>Publish rate</Button>
      </CardBody>
    </Card>
  );
}

/** Add or change one string of a language pack (#86, #87). */
function TranslationCard() {
  const toast = useToast();
  const [f, setF] = useState({ locale: 'hi', key: '', value: '' });
  const [tried, setTried] = useState(false);
  const e = {
    locale: !/^[a-z]{2}(-[A-Z]{2})?$/.test(f.locale.trim()) ? 'Like hi, ta or en-IN' : undefined,
    key: !f.key.trim() ? 'Which text' : undefined,
    value: !f.value.trim() ? 'The translation' : undefined,
  };
  const save = useMutation({
    mutationFn: () => i18nApi.upsertTranslation(f.locale.trim(), f.key.trim(), f.value.trim()),
    onSuccess: () => { toast.success(`Saved “${f.key.trim()}” in ${f.locale.trim()}`); setF({ ...f, key: '', value: '' }); setTried(false); },
    onError: (x) => toast.error(errText(x, 'Could not save')),
  });
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Languages className="h-4 w-4" /> Language packs</span>} subtitle="A new language starts with its first string" />
      <CardBody className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-3 gap-3">
          <Input label="Language" value={f.locale} maxLength={10} error={tried ? e.locale : undefined} onChange={(x) => setF({ ...f, locale: x.target.value })} />
          <div className="col-span-2"><Input label="Text key" value={f.key} maxLength={160} error={tried ? e.key : undefined} onChange={(x) => setF({ ...f, key: x.target.value })} placeholder="booking.confirmed.title" /></div>
        </div>
        <Input label="Translation" value={f.value} maxLength={4000} error={tried ? e.value : undefined} onChange={(x) => setF({ ...f, value: x.target.value })} placeholder="आपकी बुकिंग पक्की है" />
        <Button className="self-start" loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); if (!e.locale && !e.key && !e.value) save.mutate(); }}>Save</Button>
      </CardBody>
    </Card>
  );
}
