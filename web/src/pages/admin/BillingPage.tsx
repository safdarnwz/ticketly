import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Percent, Plus } from 'lucide-react';

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageLoader,
  Select,
  Table,
  useToast,
  type Column,
} from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { platformAdminApi, type PlatformDiscount, type PlatformInvoice } from '@/lib/api/platformAdmin';
import { tenantsApi } from '@/lib/api/tenants';
import { SectionTabs } from '@/components/common/SectionTabs';
import { formatDateTime, formatMoney, todayLocal } from '@/lib/utils';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * What the platform bills operators (#100, #101): GST invoices for a period
 * (commission, per-bus fees, messages — less any discount) and discounts
 * given to one operator or to all.
 */
export function BillingPage() {
  const [tenantId, setTenantId] = useState('');
  const [making, setMaking] = useState(false);
  const [discounting, setDiscounting] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const ops = useQuery({ queryKey: ['tenants'], queryFn: tenantsApi.list });
  const name = (id: string | null) =>
    id ? (ops.data?.items.find((t) => t.id === id)?.displayName ?? id.slice(0, 8)) : 'Every operator';
  const invoices = useQuery({
    queryKey: ['platform-invoices', tenantId],
    queryFn: () => platformAdminApi.invoices(tenantId || undefined),
  });
  const discounts = useQuery({
    queryKey: ['platform-discounts', tenantId],
    queryFn: () => platformAdminApi.discounts(tenantId || undefined),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => platformAdminApi.revokeDiscount(id),
    onSuccess: () => {
      toast.success('Discount revoked — later invoices are billed in full');
      void qc.invalidateQueries({ queryKey: ['platform-discounts'] });
    },
    onError: (e) => toast.error(errText(e, 'Could not revoke')),
  });
  const invCols: Column<PlatformInvoice>[] = [
    { key: 'no', header: 'Invoice', look: 'key', render: (r) => <span className="font-mono">{r.invoiceNumber}</span> },
    { key: 'op', header: 'Operator', under: 'no', render: (r) => name(r.tenantId) },
    { key: 'p', header: 'Period', look: 'muted', under: 'no', render: (r) => `${r.periodFrom} → ${r.periodTo}` },
    {
      key: 'd',
      header: 'Discount',
      look: 'count',
      under: 't',
      render: (r) => (r.discountMinor ? formatMoney(r.discountMinor, r.currency) : '—'),
    },
    { key: 'g', header: 'GST', look: 'count', under: 't', render: (r) => formatMoney(r.gstMinor, r.currency) },
    { key: 't', header: 'Total', look: 'figure', render: (r) => <b>{formatMoney(r.totalMinor, r.currency)}</b> },
    {
      key: 'a',
      header: '',
      render: (r) => (
        <Button size="sm" variant="ghost" onClick={() => setViewing(r.id)}>
          View
        </Button>
      ),
    },
  ];
  const discCols: Column<PlatformDiscount>[] = [
    { key: 'op', header: 'For', look: 'strong', render: (r) => name(r.tenantId) },
    {
      key: 'v',
      header: 'Discount',
      look: 'figure',
      render: (r) => (r.kind === 'percent' ? `${r.value}%` : formatMoney(Math.round(r.value))),
    },
    { key: 'w', header: 'Valid', look: 'muted', under: 'v', render: (r) => `${r.validFrom} → ${r.validTo ?? 'open-ended'}` },
    { key: 'r', header: 'Reason', look: 'note', under: 'op', render: (r) => <span className="text-text-muted">{r.reason}</span> },
    {
      key: 's',
      header: '',
      render: (r) =>
        r.revokedAt ? (
          <Badge tone="neutral">revoked</Badge>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            loading={revoke.isPending && revoke.variables === r.id}
            disabled={revoke.isPending}
            onClick={() => {
              if (window.confirm('Revoke this discount?')) revoke.mutate(r.id);
            }}
          >
            Revoke
          </Button>
        ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="Platform invoices to operators and the discounts they get"
        action={
          <div className="flex gap-2">
            <Button variant="outline" leftIcon={<Percent className="h-4 w-4" />} onClick={() => setDiscounting(true)}>
              Give a discount
            </Button>
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setMaking(true)}>
              Generate invoice
            </Button>
          </div>
        }
      />
      <div className="mb-4 w-72">
        <Select
          label="Operator"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          options={[
            { value: '', label: 'All operators' },
            ...(ops.data?.items ?? []).map((t) => ({ value: t.id, label: t.displayName })),
          ]}
        />
      </div>
      <SectionTabs
        sections={[
          {
            key: 'invoices',
            label: 'Invoices',
            render: () => (
              <Card>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Invoices
                    </span>
                  }
                />
                <CardBody className="p-0">
                  {invoices.isLoading ? (
                    <PageLoader />
                  ) : invoices.isError ? (
                    <ErrorState error={invoices.error} onRetry={invoices.refetch} />
                  ) : invoices.data!.items.length === 0 ? (
                    <EmptyState title="No invoices yet" description="Generate one for an operator and a period." />
                  ) : (
                    <Table columns={invCols} rows={invoices.data!.items} />
                  )}
                </CardBody>
              </Card>
            ),
          },
          {
            key: 'discounts',
            label: 'Discounts',
            render: () => (
              <Card>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <Percent className="h-4 w-4" /> Discounts
                    </span>
                  }
                />
                <CardBody className="p-0">
                  {discounts.isLoading ? (
                    <PageLoader />
                  ) : discounts.isError ? (
                    <ErrorState error={discounts.error} onRetry={discounts.refetch} />
                  ) : discounts.data!.items.length === 0 ? (
                    <EmptyState
                      title="No discounts"
                      description="A discount lowers what an operator (or every operator) is billed."
                    />
                  ) : (
                    <Table columns={discCols} rows={discounts.data!.items} />
                  )}
                </CardBody>
              </Card>
            ),
          },
        ]}
      />
      {making && (
        <GenerateModal
          operators={ops.data?.items ?? []}
          onClose={() => setMaking(false)}
          onMade={(id) => {
            setMaking(false);
            setViewing(id);
          }}
        />
      )}
      {discounting && <DiscountModal operators={ops.data?.items ?? []} onClose={() => setDiscounting(false)} />}
      {viewing && <InvoiceModal id={viewing} operator={(id) => name(id)} onClose={() => setViewing(null)} />}
    </>
  );
}

type Op = { id: string; displayName: string };
const firstOfLastMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};
const lastOfLastMonth = () => {
  const d = new Date();
  d.setDate(0);
  return d.toISOString().slice(0, 10);
};

function GenerateModal({ operators, onClose, onMade }: { operators: Op[]; onClose: () => void; onMade: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ tenantId: '', from: firstOfLastMonth(), to: lastOfLastMonth() });
  const [tried, setTried] = useState(false);
  // One key per operator + period: a double click or a retry issues one invoice.
  const key = `invoice-${f.tenantId}-${f.from}-${f.to}`;
  const e = {
    tenantId: !f.tenantId ? 'Choose the operator' : undefined,
    to:
      !f.from || !f.to
        ? 'Pick both dates'
        : f.to < f.from
          ? 'Must be on or after the start'
          : f.to >= todayLocal()
            ? 'Up to yesterday — today is not over'
            : undefined,
  };
  const go = useMutation({
    mutationFn: () => platformAdminApi.generateInvoice(f, key),
    onSuccess: (r) => {
      if (r.created) toast.success(`Invoice ${r.invoice.invoiceNumber} issued`);
      else toast.info(`That period is already billed — invoice ${r.invoice.invoiceNumber}`);
      void qc.invalidateQueries({ queryKey: ['platform-invoices'] });
      onMade(r.invoice.id);
    },
    onError: (x) => toast.error(errText(x, 'Could not generate the invoice')),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Generate a platform invoice"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={go.isPending}>
            Cancel
          </Button>
          <Button
            loading={go.isPending}
            disabled={go.isPending}
            onClick={() => {
              setTried(true);
              if (!e.tenantId && !e.to) go.mutate();
            }}
          >
            Generate
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <Select
          label="Operator"
          value={f.tenantId}
          error={tried ? e.tenantId : undefined}
          onChange={(x) => setF({ ...f, tenantId: x.target.value })}
          options={[{ value: '', label: 'Choose' }, ...operators.map((t) => ({ value: t.id, label: t.displayName }))]}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input label="From" type="date" value={f.from} onChange={(x) => setF({ ...f, from: x.target.value })} />
          <Input
            label="To"
            type="date"
            value={f.to}
            error={tried ? e.to : undefined}
            onChange={(x) => setF({ ...f, to: x.target.value })}
          />
        </div>
        <p className="text-xs text-text-muted">
          A period already billed opens the invoice issued for it — nothing is billed twice.
        </p>
      </div>
    </Modal>
  );
}

function DiscountModal({ operators, onClose }: { operators: Op[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    tenantId: '',
    kind: 'percent' as 'percent' | 'flat',
    value: '',
    reason: '',
    validFrom: todayLocal(),
    validTo: '',
  });
  const [tried, setTried] = useState(false);
  const v = Number(f.value);
  const e = {
    value: !(v > 0) ? 'More than 0' : f.kind === 'percent' && v > 100 ? 'At most 100%' : undefined,
    reason: f.reason.trim().length < 3 ? 'Say why (the operator sees it on the invoice)' : undefined,
    validTo: f.validTo && f.validTo < f.validFrom ? 'Must be on or after the start' : undefined,
  };
  const go = useMutation({
    mutationFn: () =>
      platformAdminApi.createDiscount({
        tenantId: f.tenantId || null,
        kind: f.kind,
        value: f.kind === 'flat' ? Math.round(v * 100) : v,
        reason: f.reason.trim(),
        validFrom: f.validFrom,
        validTo: f.validTo || null,
      }),
    onSuccess: () => {
      toast.success('Discount added — it applies to invoices from its start date');
      void qc.invalidateQueries({ queryKey: ['platform-discounts'] });
      onClose();
    },
    onError: (x) => toast.error(errText(x, 'Could not add the discount')),
  });
  const err = (k: keyof typeof e) => (tried ? e[k] : undefined);
  return (
    <Modal
      open
      onClose={onClose}
      title="Give a discount"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={go.isPending}>
            Cancel
          </Button>
          <Button
            loading={go.isPending}
            disabled={go.isPending}
            onClick={() => {
              setTried(true);
              if (!Object.values(e).some(Boolean)) go.mutate();
            }}
          >
            Add discount
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="col-span-2">
          <Select
            label="For"
            value={f.tenantId}
            onChange={(x) => setF({ ...f, tenantId: x.target.value })}
            options={[{ value: '', label: 'Every operator' }, ...operators.map((t) => ({ value: t.id, label: t.displayName }))]}
          />
        </div>
        <Select
          label="Kind"
          value={f.kind}
          onChange={(x) => setF({ ...f, kind: x.target.value as 'percent' | 'flat' })}
          options={[
            { value: 'percent', label: 'Percent of the bill' },
            { value: 'flat', label: 'Fixed amount (₹)' },
          ]}
        />
        <Input
          label={f.kind === 'percent' ? 'Percent' : 'Amount (₹)'}
          type="number"
          value={f.value}
          error={err('value')}
          onChange={(x) => setF({ ...f, value: x.target.value })}
        />
        <Input label="From" type="date" value={f.validFrom} onChange={(x) => setF({ ...f, validFrom: x.target.value })} />
        <Input
          label="Until (optional)"
          type="date"
          value={f.validTo}
          error={err('validTo')}
          onChange={(x) => setF({ ...f, validTo: x.target.value })}
        />
        <div className="col-span-2">
          <Input
            label="Reason"
            value={f.reason}
            maxLength={300}
            error={err('reason')}
            onChange={(x) => setF({ ...f, reason: x.target.value })}
            placeholder="Launch offer — first 3 months"
          />
        </div>
      </div>
    </Modal>
  );
}

function InvoiceModal({ id, operator, onClose }: { id: string; operator: (id: string) => string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['platform-invoice', id], queryFn: () => platformAdminApi.invoice(id) });
  const inv = q.data;
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={inv ? `Invoice ${inv.invoiceNumber}` : 'Invoice'}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : (
        inv && (
          <div className="flex flex-col gap-2 text-sm">
            <div className="text-text-muted">
              {operator(inv.tenantId)} · {inv.periodFrom} → {inv.periodTo} · issued {formatDateTime(inv.createdAt)}
            </div>
            <div className="divide-y divide-border rounded-md border border-border">
              {inv.lines.map((l, i) => (
                <div key={i} className="flex justify-between px-3 py-2">
                  <span>
                    {l.description}
                    {l.count ? ` × ${l.count}` : ''}
                  </span>
                  <span>
                    {formatMoney(l.baseMinor, inv.currency)}{' '}
                    <span className="text-xs text-text-muted">+ GST {formatMoney(l.gstMinor, inv.currency)}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Subtotal</span>
              <span>{formatMoney(inv.subtotalMinor, inv.currency)}</span>
            </div>
            {inv.discountMinor > 0 && (
              <div className="flex justify-between">
                <span className="text-text-muted">Discount</span>
                <span>− {formatMoney(inv.discountMinor, inv.currency)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-text-muted">GST</span>
              <span>{formatMoney(inv.gstMinor, inv.currency)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-2 font-semibold">
              <span>Total</span>
              <span>{formatMoney(inv.totalMinor, inv.currency)}</span>
            </div>
          </div>
        )
      )}
    </Modal>
  );
}
