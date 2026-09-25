import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowRightLeft } from 'lucide-react';

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
      <PageHeader title="i18n & Currency" subtitle="Multi-currency conversion at your quoted rates" />
      <div className="max-w-2xl">
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
