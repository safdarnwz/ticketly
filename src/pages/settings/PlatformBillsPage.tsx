import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';

import { Button, EmptyState, ErrorState, Modal, PageLoader, Table, type Column } from '@/components/ui';
import { operatorProfileApi, type PlatformInvoice } from '@/lib/api/operatorProfile';
import { formatDateLabel, formatMoney } from '@/lib/utils';

const d = (s: string) => formatDateLabel(s.slice(0, 10), { day: '2-digit', month: 'short', year: 'numeric' });

/** What Ticketly billed you: plan, per-bus fees and commission, with GST. */
export function PlatformBillsPage() {
  const q = useQuery({ queryKey: ['platform-invoices'], queryFn: operatorProfileApi.invoices });
  const [open, setOpen] = useState<PlatformInvoice | null>(null);
  const cols: Column<PlatformInvoice>[] = [
    { key: 'no', header: 'Invoice', render: (i) => <span className="font-mono">{i.invoiceNumber}</span> },
    { key: 'period', header: 'Period', render: (i) => `${d(i.periodFrom)} – ${d(i.periodTo)}` },
    { key: 'total', header: 'Total', render: (i) => formatMoney(i.totalMinor, i.currency) },
    { key: 'act', header: '', render: (i) => <Button size="sm" variant="ghost" onClick={() => setOpen(i)}>View</Button> },
  ];
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <>
      {(q.data?.items.length ?? 0) === 0 ? <EmptyState title="No bills yet" description="Ticketly's monthly invoices to you appear here." icon={<Receipt className="h-10 w-10" />} /> : <Table columns={cols} rows={q.data!.items} />}
      {open && (
        <Modal open onClose={() => setOpen(null)} title={`Invoice ${open.invoiceNumber}`} size="lg">
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-text-muted"><th>Item</th><th>Qty</th><th className="text-right">Amount</th><th className="text-right">GST</th></tr></thead>
            <tbody>{open.lines.map((l, i) => <tr key={i} className="border-t border-border"><td className="py-1">{l.description}</td><td>{l.count}</td><td className="text-right">{formatMoney(l.baseMinor, open.currency)}</td><td className="text-right">{formatMoney(l.gstMinor, open.currency)}</td></tr>)}</tbody></table>
          <div className="mt-3 flex flex-col items-end gap-1 text-sm">
            <div>Subtotal {formatMoney(open.subtotalMinor, open.currency)}</div>
            {open.discountMinor > 0 && <div className="text-success">Discount −{formatMoney(open.discountMinor, open.currency)}</div>}
            <div>GST {formatMoney(open.gstMinor, open.currency)}</div>
            <div className="text-base font-semibold">Total {formatMoney(open.totalMinor, open.currency)}</div>
          </div>
        </Modal>
      )}
    </>
  );
}
