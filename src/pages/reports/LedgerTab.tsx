import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, Search } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, PageLoader, Select } from '@/components/ui';
import { ledgerApi, LEDGER_ENTRY_TYPES, type LedgerEntry } from '@/lib/api/reports';
import { cn, downloadCsv, formatDateTime, formatMoney } from '@/lib/utils';

const TYPE_LABEL: Record<string, string> = {
  'booking.captured': 'Payment received',
  'booking.captured_offline': 'Agent / partner sale',
  'booking.partner_commission': 'Partner commission',
  'refund.paid': 'Refund paid',
  'refund.offline': 'Agent / partner refund',
  'refund.partner_commission': 'Partner commission returned',
  'settlement.paid': 'Payout to you',
};
const ACCOUNT_LABEL: Record<string, string> = {
  gateway_clearing: 'Payment gateway (in transit)',
  operator_payable: 'Owed to you',
  platform_revenue: 'Platform commission',
  commission_tax_payable: 'GST on commission',
  customer_refunds: 'Refunds to customers',
  operator_wallet: 'Your wallet / payouts',
};
const acct = (a: string) => ACCOUNT_LABEL[a] ?? a;
const money = (m: number) => formatMoney(Math.abs(m), 'INR');
/** Debit (+) / credit (−) in accounting terms; the sum of an entry is always zero. */
const side = (m: number) => (m >= 0 ? 'Dr' : 'Cr');

/**
 * The financial audit trail: every ledger entry of the period with its postings,
 * traceable to the booking (PNR) or payout that caused it, plus the running
 * trial balance — the books must always add up to zero.
 */
export function LedgerTab({ from, to }: { from: string; to: string }) {
  const [type, setType] = useState('');
  const [pnrInput, setPnrInput] = useState('');
  const [pnr, setPnr] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const pnrError = pnrInput && pnrInput.trim().length < 4 ? 'At least 4 characters' : undefined;

  const tb = useQuery({ queryKey: ['trial-balance'], queryFn: ledgerApi.trialBalance, staleTime: 60_000 });
  const q = useInfiniteQuery({
    queryKey: ['ledger', from, to, type, pnr],
    queryFn: ({ pageParam }) => ledgerApi.journal({ from, to, type: type || undefined, pnr: pnr || undefined, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const items: LedgerEntry[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const exportCsv = () => downloadCsv(`ledger-${from}-to-${to}.csv`, [
    ['Date', 'Entry', 'Type', 'PNR / source', 'Account', 'Debit (₹)', 'Credit (₹)'],
    ...items.flatMap((e) => e.postings.map((p) => [
      formatDateTime(e.createdAt), e.id, TYPE_LABEL[e.type] ?? e.type, e.pnr ?? `${e.sourceType} ${e.sourceId}`, acct(p.account),
      p.amountMinor > 0 ? (p.amountMinor / 100).toFixed(2) : '', p.amountMinor < 0 ? (-p.amountMinor / 100).toFixed(2) : '',
    ])),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Trial balance" subtitle="All-time net of every account — debits and credits must cancel out"
          action={tb.data && <Badge tone={tb.data.balanced ? 'success' : 'danger'}>{tb.data.balanced ? 'Books balance' : `Out by ${money(tb.data.total)}`}</Badge>} />
        <CardBody>
          {tb.isLoading ? <PageLoader /> : tb.isError ? <ErrorState error={tb.error} onRetry={tb.refetch} /> : !tb.data?.accounts.length ? <EmptyState title="No money has moved yet" /> : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {tb.data.accounts.map((a) => (
                <div key={a.account} className="rounded-md border border-border px-3 py-2">
                  <div className="text-xs text-text-muted">{acct(a.account)}</div>
                  <div className="font-semibold text-text">{money(Number(a.balance))} <span className="text-xs font-normal text-text-muted">{side(Number(a.balance))}</span></div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Journal" subtitle="Every entry in the period, newest first — open one to see its postings" />
        <CardBody className="flex flex-col gap-3">
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!pnrError) setPnr(pnrInput.trim().toUpperCase()); }}>
            <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}
              options={[{ value: '', label: 'All entries' }, ...LEDGER_ENTRY_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] ?? t }))]} />
            <Input label="PNR" value={pnrInput} maxLength={20} placeholder="e.g. GKAGFB" error={pnrError} onChange={(e) => { setPnrInput(e.target.value); if (!e.target.value) setPnr(''); }} />
            <Button type="submit" variant="outline" leftIcon={<Search className="h-4 w-4" />} disabled={!!pnrError}>Find</Button>
            {(type || pnr) && <Button type="button" variant="ghost" onClick={() => { setType(''); setPnr(''); setPnrInput(''); }}>Clear</Button>}
            <Button type="button" className="ml-auto" variant="outline" leftIcon={<Download className="h-4 w-4" />} disabled={!items.length} onClick={exportCsv}>Export loaded (CSV)</Button>
          </form>

          {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : items.length === 0 ? (
            <EmptyState title={pnr || type ? 'No entries match' : 'No money moved in this period'} description={pnr ? `Nothing for PNR ${pnr} in these dates — widen the dates above.` : undefined} />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs text-text-muted">
                  <tr><th className="w-8" /><th className="px-3 py-2">When</th><th className="px-3 py-2">Entry</th><th className="px-3 py-2">For</th><th className="px-3 py-2 text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {items.map((e) => {
                    const amount = e.postings.filter((p) => p.amountMinor > 0).reduce((s, p) => s + p.amountMinor, 0);
                    const isOpen = open.has(e.id);
                    return (
                      <Fragment key={e.id}>
                        <tr className="cursor-pointer border-t border-border hover:bg-surface-muted" onClick={() => toggle(e.id)}>
                          <td className="px-2">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                          <td className="whitespace-nowrap px-3 py-2">{formatDateTime(e.createdAt)}</td>
                          <td className="px-3 py-2"><Badge tone={e.type.startsWith('refund') ? 'warning' : e.type.startsWith('settlement') ? 'info' : 'success'}>{TYPE_LABEL[e.type] ?? e.type}</Badge></td>
                          <td className="px-3 py-2">{e.pnr ? <Link className="font-mono text-primary hover:underline" to={`/bookings/${e.pnr}`} onClick={(ev) => ev.stopPropagation()}>{e.pnr}</Link> : <span className="text-text-muted">{e.sourceType} {e.sourceId.slice(0, 8)}</span>}</td>
                          <td className="px-3 py-2 text-right font-medium">{money(amount)}</td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-surface-muted/50"><td /><td colSpan={4} className="px-3 pb-3">
                            <table className="w-full text-xs">
                              <thead className="text-text-muted"><tr><th className="py-1 text-left">Account</th><th className="py-1 text-right">Debit</th><th className="py-1 text-right">Credit</th></tr></thead>
                              <tbody>{e.postings.map((p, i) => (
                                <tr key={i}><td className="py-0.5">{acct(p.account)}</td>
                                  <td className="py-0.5 text-right">{p.amountMinor > 0 ? money(p.amountMinor) : ''}</td>
                                  <td className="py-0.5 text-right">{p.amountMinor < 0 ? money(p.amountMinor) : ''}</td></tr>
                              ))}</tbody>
                            </table>
                            <div className="mt-1 text-text-muted">Entry {e.id}</div>
                          </td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {q.hasNextPage && <Button variant="outline" className={cn('self-center')} loading={q.isFetchingNextPage} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load more</Button>}
        </CardBody>
      </Card>
    </div>
  );
}
