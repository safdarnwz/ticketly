import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Plus, RotateCcw, Search } from 'lucide-react';

import { Badge, Button, Card, CardBody, EmptyState, ErrorState, Input, Modal, PageLoader, Select, Table, useToast, type Column } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { ApiError } from '@/lib/api/client';
import { bookingsApi } from '@/lib/api/bookings';
import { refundsApi, type RefundQueue, type RefundQueueRow, type RefundStatus } from '@/lib/api/ops';
import { cn, formatDateTime, formatMoney, idempotencyKey } from '@/lib/utils';

const TABS: { key: RefundQueue; label: string }[] = [
  { key: 'action', label: 'Needs action' },
  { key: 'processing', label: 'With the gateway' },
  { key: 'done', label: 'Paid' },
  { key: 'all', label: 'All' },
];

const STATUS: Record<RefundStatus, [string, 'success' | 'warning' | 'danger' | 'neutral' | 'info']> = {
  initiated: ['Started', 'info'],
  processing: ['Processing', 'info'],
  settled: ['Refunded', 'success'],
  manual: ['Paid by transfer', 'success'],
  failed: ['Failed', 'danger'],
  cancelled: ['Cancelled', 'neutral'],
};

const needsTransfer = (r: RefundQueueRow) => r.status === 'processing' && r.destination === 'alternate_account';

/**
 * The refunds desk: what needs a person first (failed refunds, bank transfers
 * to send), then what the gateway is still processing, then what is paid.
 * Manual refunds for a booking start from its PNR and can never exceed what
 * is still refundable.
 */
export function RefundsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<RefundQueue>('action');
  const [pnr, setPnr] = useState('');
  const [paying, setPaying] = useState<RefundQueueRow | null>(null);
  const [creating, setCreating] = useState(false);
  const filter = pnr.trim().toUpperCase();

  const queue = useInfiniteQuery({
    queryKey: ['refund-queue', tab, filter],
    queryFn: ({ pageParam }) => refundsApi.queue(tab, { pnr: filter || undefined, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const rows = queue.data?.pages.flatMap((p) => p.items) ?? [];
  const needsAction = queue.data?.pages[0]?.needsAction ?? 0;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['refund-queue'] }); void qc.invalidateQueries({ queryKey: ['refunds'] }); };

  const retry = useMutation({
    mutationFn: (id: string) => refundsApi.retry(id),
    onSuccess: (r) => { toast.success(r.status === 'settled' ? 'Refunded' : r.status === 'failed' ? 'The gateway refused it again — pay it by transfer' : 'Sent to the gateway again'); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const columns: Column<RefundQueueRow>[] = [
    { key: 'pnr', header: 'Booking', render: (r) => <div><Link to={`/bookings/${r.bookingId}`} className="font-mono font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{r.pnr}</Link>{r.contactPhone && <div className="text-xs text-text-muted">{r.contactPhone}</div>}</div> },
    { key: 'amount', header: 'Amount', render: (r) => <span className="font-semibold">{formatMoney(r.amountMinor, r.currency)}</span> },
    {
      key: 'to', header: 'To', render: (r) => r.destination === 'alternate_account'
        ? <div className="text-sm"><div>{r.accountHolder}</div><div className="text-xs text-text-muted">{r.bankName ?? 'Bank'} {r.accountMasked} · {r.ifsc}</div></div>
        : <span className="text-sm text-text-muted">Original payment</span>,
    },
    {
      key: 'status', header: 'Status', render: (r) => {
        const [label, tone] = needsTransfer(r) ? ['Transfer to send', 'warning' as const] : STATUS[r.status];
        return (
          <div>
            <Badge tone={tone}>{label}</Badge>
            {r.failureReason && r.status === 'failed' && <div className="mt-1 max-w-56 text-xs text-danger">{r.failureReason}</div>}
            {r.payoutReference && <div className="mt-1 text-xs text-text-muted">UTR {r.payoutReference}</div>}
          </div>
        );
      },
    },
    { key: 'when', header: 'Raised', render: (r) => <span className="text-xs text-text-muted">{formatDateTime(r.createdAt)}</span> },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-2">
          {r.status === 'failed' && r.destination === 'source' && (
            <Button size="sm" variant="outline" leftIcon={<RotateCcw className="h-4 w-4" />} loading={retry.isPending && retry.variables === r.id} disabled={retry.isPending} onClick={() => retry.mutate(r.id)}>Retry</Button>
          )}
          {(r.status === 'failed' || needsTransfer(r)) && (
            <Button size="sm" leftIcon={<Banknote className="h-4 w-4" />} onClick={() => setPaying(r)}>Mark paid</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Refunds" subtitle="Refunds that need you first — failed ones and bank transfers to send — then everything else"
        action={<Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New refund</Button>} />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex overflow-hidden rounded-md border border-border text-sm" role="tablist">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                className={cn('flex items-center gap-1.5 px-3 py-2', tab === t.key ? 'bg-primary text-white' : 'bg-surface text-text hover:bg-surface-muted')}>
                {t.label}
                {t.key === 'action' && needsAction > 0 && <span className={cn('rounded-full px-1.5 text-xs', tab === t.key ? 'bg-white/25' : 'bg-danger text-white')}>{needsAction}</span>}
              </button>
            ))}
          </div>
          <div className="w-60"><Input aria-label="Filter by PNR" placeholder="Filter by PNR" leftIcon={<Search className="h-4 w-4" />} value={pnr} onChange={(e) => setPnr(e.target.value)} /></div>
        </CardBody>
      </Card>

      {queue.isLoading ? <PageLoader /> : queue.isError ? <ErrorState error={queue.error} onRetry={queue.refetch} /> : rows.length === 0 ? (
        <EmptyState title={tab === 'action' ? 'Nothing needs you' : 'No refunds here'} description={tab === 'action' ? 'Failed refunds and bank transfers to send show up here.' : filter ? `No refunds for PNR ${filter}.` : 'Refunds appear as bookings are cancelled.'} icon={<RotateCcw className="h-10 w-10" />} />
      ) : (
        <>
          <Table columns={columns} rows={rows} />
          {queue.hasNextPage && <div className="mt-3 flex justify-center"><Button variant="outline" loading={queue.isFetchingNextPage} onClick={() => void queue.fetchNextPage()}>Load more</Button></div>}
        </>
      )}

      {paying && <MarkPaidModal refund={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); refresh(); }} />}
      {creating && <NewRefundModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); setTab('all'); refresh(); }} />}
    </>
  );
}

function MarkPaidModal({ refund, onClose, onDone }: { refund: RefundQueueRow; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reference, setReference] = useState('');
  const [tried, setTried] = useState(false);
  const transfer = refund.destination === 'alternate_account';
  const account = useQuery({ queryKey: ['refund-payout', refund.id], queryFn: () => refundsApi.payout(refund.id), enabled: transfer });
  const ref = reference.trim().toUpperCase();
  const error = /^[A-Z0-9]{6,30}$/.test(ref) ? undefined : 'Enter the transfer reference (UTR), 6–30 letters or digits';
  const pay = useMutation({
    mutationFn: () => refundsApi.markPaid(refund.id, ref),
    onSuccess: () => { toast.success(`${formatMoney(refund.amountMinor, refund.currency)} to ${refund.pnr} recorded as paid`); onDone(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  return (
    <Modal open onClose={onClose} title={`Mark refund paid — ${refund.pnr}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={pay.isPending}>Cancel</Button><Button loading={pay.isPending} disabled={pay.isPending || (tried && !!error)} onClick={() => { setTried(true); if (!error) pay.mutate(); }}>Record payment</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="rounded-md bg-surface-muted p-3">
          <div className="text-xs text-text-muted">Amount</div>
          <div className="text-lg font-semibold">{formatMoney(refund.amountMinor, refund.currency)}</div>
        </div>
        {transfer ? (
          account.isLoading ? <PageLoader /> : account.isError ? <ErrorState error={account.error} onRetry={account.refetch} /> : account.data && (
            <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-3">
              <div><div className="text-xs text-text-muted">Account holder</div><div className="font-medium">{account.data.accountHolder}</div></div>
              <div><div className="text-xs text-text-muted">Bank</div><div className="font-medium">{account.data.bankName ?? '—'}</div></div>
              <div><div className="text-xs text-text-muted">Account number</div><div className="font-mono font-medium">{account.data.accountNumber}</div></div>
              <div><div className="text-xs text-text-muted">IFSC</div><div className="font-mono font-medium">{account.data.ifsc}</div></div>
            </div>
          )
        ) : <p className="text-text-muted">The gateway could not refund this{refund.failureReason ? ` (${refund.failureReason})` : ''}. Pay the customer by bank transfer, then record it here.</p>}
        <Input label="Transfer reference (UTR)" placeholder="e.g. HDFCN52026092512345" value={reference} error={tried ? error : undefined} onChange={(e) => setReference(e.target.value)} />
        <p className="text-xs text-text-muted">Recording closes the refund and tells the customer. It cannot be undone.</p>
      </div>
    </Modal>
  );
}

function NewRefundModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pnr, setPnr] = useState('');
  const [booking, setBooking] = useState<{ id: string; pnr: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState<'source' | 'alternate_account'>('source');
  const [acct, setAcct] = useState({ accountHolder: '', accountNumber: '', ifsc: '', bankName: '' });
  const [tried, setTried] = useState(false);

  const lookup = useMutation({
    mutationFn: () => bookingsApi.byPnrStaff(pnr.trim().toUpperCase()),
    onSuccess: (r) => { setBooking({ id: r.booking.id, pnr: r.booking.pnr }); setAmount(''); },
    onError: () => setBooking(null),
  });
  const summary = useQuery({ queryKey: ['refunds', booking?.id], queryFn: () => refundsApi.forBooking(booking!.id), enabled: !!booking });
  const s = summary.data;
  const minor = Math.round(Number(amount) * 100);
  const errors: Record<string, string> = {};
  if (!amount.trim() || !Number.isFinite(minor) || minor < 100) errors.amount = 'At least ₹1';
  else if (s && minor > s.refundableMinor) errors.amount = `At most ${formatMoney(s.refundableMinor, s.currency)} — what is still refundable`;
  if (destination === 'alternate_account') {
    if (acct.accountHolder.trim().length < 2) errors.accountHolder = 'Enter the name on the account';
    if (!/^\d{9,18}$/.test(acct.accountNumber.replace(/\s/g, ''))) errors.accountNumber = 'An account number is 9 to 18 digits';
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(acct.ifsc.trim().toUpperCase())) errors.ifsc = 'An IFSC is 11 characters, like SBIN0001234';
  }
  // One key per distinct refund: a retry of the same one replays, a changed form is a new refund.
  const key = useMemo(() => idempotencyKey('refund'), [booking?.id, minor, destination, acct.accountNumber]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useMutation({
    mutationFn: () => refundsApi.initiate(booking!.id, minor, destination, key, destination === 'alternate_account'
      ? { accountHolder: acct.accountHolder.trim(), accountNumber: acct.accountNumber.replace(/\s/g, ''), ifsc: acct.ifsc.trim().toUpperCase(), bankName: acct.bankName.trim() || undefined }
      : undefined),
    onSuccess: (r) => {
      toast.success(r.status === 'settled' ? 'Refunded' : destination === 'alternate_account' ? 'Refund recorded — send the transfer, then mark it paid' : r.status === 'failed' ? 'The gateway refused it — it is in Needs action' : 'Refund sent to the gateway');
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Refund failed'),
  });
  const server = create.error instanceof ApiError ? create.error.fieldErrors : {};
  const err = (k: string, api = k) => (tried ? errors[k] : undefined) ?? server[api] ?? server[`altAccountDetails.${api}`];
  const invalid = Object.keys(errors).length > 0;

  return (
    <Modal open onClose={onClose} title="New refund" size="lg"
      footer={<><Button variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button><Button loading={create.isPending} disabled={!booking || !s || s.refundableMinor === 0 || create.isPending || (tried && invalid)} onClick={() => { setTried(true); if (!invalid) create.mutate(); }}>Refund {minor >= 100 ? formatMoney(minor, s?.currency ?? 'INR') : ''}</Button></>}>
      <div className="flex flex-col gap-4">
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (pnr.trim()) lookup.mutate(); }}>
          <div className="flex-1"><Input label="PNR" placeholder="e.g. TKT8X92QF" value={pnr} onChange={(e) => setPnr(e.target.value.toUpperCase())} error={lookup.isError ? (lookup.error instanceof Error ? lookup.error.message : 'Not found') : undefined} /></div>
          <Button type="submit" variant="outline" loading={lookup.isPending} disabled={!pnr.trim()}>Find booking</Button>
        </form>
        {booking && (summary.isLoading ? <PageLoader /> : summary.isError ? <ErrorState error={summary.error} onRetry={summary.refetch} /> : s && (
          <>
            <div className="grid grid-cols-3 gap-2 rounded-md bg-surface-muted p-3 text-sm">
              <div><div className="text-xs text-text-muted">Paid</div><div className="font-semibold">{formatMoney(s.capturedMinor, s.currency)}</div></div>
              <div><div className="text-xs text-text-muted">Already refunded</div><div className="font-semibold">{formatMoney(s.refundedMinor, s.currency)}</div></div>
              <div><div className="text-xs text-text-muted">Still refundable</div><div className="font-semibold text-success">{formatMoney(s.refundableMinor, s.currency)}</div></div>
            </div>
            {s.refundableMinor === 0 ? <p className="text-sm text-text-muted">Everything paid for <b>{booking.pnr}</b> has been refunded — nothing more can go back.</p> : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Amount (₹)" type="number" min={1} step="0.01" value={amount} error={err('amount', 'amountMinor')} onChange={(e) => setAmount(e.target.value)} />
                  <Select label="Refund to" value={destination} onChange={(e) => setDestination(e.target.value as 'source' | 'alternate_account')}
                    options={[{ label: 'The original payment', value: 'source' }, { label: 'Another bank account', value: 'alternate_account' }]} />
                </div>
                {destination === 'alternate_account' && (
                  <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3">
                    <p className="col-span-2 text-xs text-text-muted">The gateway can only refund the card or UPI that paid. For another account, you send a bank transfer and then mark the refund paid.</p>
                    <Input label="Account holder" value={acct.accountHolder} error={err('accountHolder')} onChange={(e) => setAcct((a) => ({ ...a, accountHolder: e.target.value }))} />
                    <Input label="Account number" inputMode="numeric" value={acct.accountNumber} error={err('accountNumber')} onChange={(e) => setAcct((a) => ({ ...a, accountNumber: e.target.value }))} />
                    <Input label="IFSC" placeholder="SBIN0001234" value={acct.ifsc} error={err('ifsc')} onChange={(e) => setAcct((a) => ({ ...a, ifsc: e.target.value.toUpperCase() }))} />
                    <Input label="Bank name (optional)" value={acct.bankName} onChange={(e) => setAcct((a) => ({ ...a, bankName: e.target.value }))} />
                  </div>
                )}
              </>
            )}
            {s.refunds.length > 0 && (
              <div className="text-xs text-text-muted">Earlier refunds: {s.refunds.map((r) => `${formatMoney(r.amountMinor, r.currency)} ${STATUS[r.status]?.[0].toLowerCase() ?? r.status}`).join(' · ')}</div>
            )}
          </>
        ))}
      </div>
    </Modal>
  );
}
