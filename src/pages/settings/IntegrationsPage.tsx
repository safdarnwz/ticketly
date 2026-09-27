import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, Mail, MessageSquare, Send, XCircle } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, ErrorState, Input, Modal, PageLoader, Select, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { platformAdminApi, type Integration, type IntegrationField } from '@/lib/api/platformAdmin';
import { formatDateTime } from '@/lib/utils';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
/** "keyId" → "Key id", "dltTemplateId" → "Dlt template id". */
const humanize = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()).replace(/ (\w)/g, (_, c: string) => ` ${c.toLowerCase()}`);
const KIND = { payment: { label: 'Payment gateways', icon: CreditCard }, sms: { label: 'SMS', icon: MessageSquare }, whatsapp: { label: 'WhatsApp', icon: MessageSquare }, email: { label: 'Email', icon: Mail } } as const;
const RUNTIME: Record<Integration['runtime'], string> = {
  live: 'Used as soon as it is enabled',
  restart: 'Used after the next restart',
  none: 'Stored for later — no adapter yet, cannot be enabled',
};

/**
 * Payment gateways, SMS, WhatsApp and email (#11–#21): credentials per
 * provider (secrets are write-only — only a masked hint comes back), enable /
 * disable, and a test send. The form fields come from the provider catalogue
 * on the server, so a new provider needs no change here.
 */
export function IntegrationsPage() {
  const q = useQuery({ queryKey: ['admin-integrations'], queryFn: platformAdminApi.integrations });
  const [editing, setEditing] = useState<Integration | null>(null);
  const [testing, setTesting] = useState<Integration | null>(null);
  const groups = (['payment', 'sms', 'whatsapp', 'email'] as const).map((k) => ({ kind: k, items: (q.data?.items ?? []).filter((i) => i.kind === k) }));

  return (
    <>
      <PageHeader title="Integrations" subtitle="Payment gateways, SMS, WhatsApp and email for the whole platform" />
      {q.isLoading ? <PageLoader /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <div className="flex flex-col gap-4">
          {groups.filter((g) => g.items.length).map(({ kind, items }) => {
            const Icon = KIND[kind].icon;
            return (
              <Card key={kind}>
                <CardHeader title={<span className="flex items-center gap-2"><Icon className="h-4 w-4" /> {KIND[kind].label}</span>} />
                <CardBody className="flex flex-col divide-y divide-border p-0">
                  {items.map((i) => <Row key={i.provider} i={i} onEdit={() => setEditing(i)} onTest={() => setTesting(i)} />)}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
      {editing && <EditModal i={editing} onClose={() => setEditing(null)} />}
      {testing && <TestModal i={testing} onClose={() => setTesting(null)} />}
    </>
  );
}

function Row({ i, onEdit, onTest }: { i: Integration; onEdit: () => void; onTest: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const toggle = useMutation({
    mutationFn: () => platformAdminApi.enableIntegration(i.provider, !i.enabled),
    onSuccess: () => { toast.success(`${i.label} ${i.enabled ? 'disabled' : 'enabled'}`); void qc.invalidateQueries({ queryKey: ['admin-integrations'] }); },
    onError: (e) => toast.error(errText(e, 'Could not change it')),
  });
  const canEnable = i.configured && i.runtime !== 'none';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium text-text">
          {i.label}
          <Badge tone={i.enabled ? 'success' : 'neutral'}>{i.enabled ? 'enabled' : 'off'}</Badge>
          {!i.configured && <Badge tone="warning">not set up</Badge>}
        </div>
        <div className="text-xs text-text-muted">{RUNTIME[i.runtime]}</div>
        {i.lastTest && (
          <div className={`mt-0.5 flex items-center gap-1 text-xs ${i.lastTest.ok ? 'text-success' : 'text-danger'}`}>
            {i.lastTest.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            Last test {formatDateTime(i.lastTest.at)}{i.lastTest.error ? ` — ${i.lastTest.error}` : ' — worked'}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>{i.configured ? 'Edit credentials' : 'Set up'}</Button>
        <Button size="sm" variant="outline" leftIcon={<Send className="h-3.5 w-3.5" />} disabled={!i.configured} title={i.configured ? undefined : 'Save credentials first'} onClick={onTest}>Test</Button>
        <Button size="sm" variant={i.enabled ? 'ghost' : 'primary'} loading={toggle.isPending} disabled={toggle.isPending || (!i.enabled && !canEnable)}
          title={!i.enabled && !canEnable ? (i.runtime === 'none' ? 'No adapter yet — it cannot be used' : 'Save credentials first') : undefined}
          onClick={() => toggle.mutate()}>{i.enabled ? 'Disable' : 'Enable'}</Button>
      </div>
    </div>
  );
}

function initialValue(f: IntegrationField, current: unknown): string | boolean {
  const v = current ?? f.defaultValue;
  if (f.type === 'boolean') return Boolean(v);
  return v === undefined || v === null ? '' : String(v);
}

function EditModal({ i, onClose }: { i: Integration; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [config, setConfig] = useState<Record<string, string | boolean>>(() => Object.fromEntries(i.fields.config.map((f) => [f.key, initialValue(f, i.config[f.key])])));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const errors: Record<string, string> = {};
  for (const f of i.fields.config) {
    const v = config[f.key];
    if (f.required && f.type !== 'boolean' && String(v ?? '').trim() === '') errors[f.key] = 'Required';
    if (f.type === 'number' && String(v).trim() !== '' && !Number.isFinite(Number(v))) errors[f.key] = 'A number';
  }
  // A secret already stored may be left empty (it is kept); a new provider needs every required one.
  for (const f of i.fields.secrets) if (f.required && !i.secrets[f.key] && !secrets[f.key]?.trim()) errors[`s.${f.key}`] = 'Required';
  const save = useMutation({
    mutationFn: () => platformAdminApi.saveIntegration(i.provider, {
      config: Object.fromEntries(i.fields.config
        .filter((f) => !(f.type !== 'boolean' && String(config[f.key]).trim() === '' && !f.required))
        .map((f) => [f.key, f.type === 'number' ? Number(config[f.key]) : f.type === 'boolean' ? Boolean(config[f.key]) : String(config[f.key]).trim()])),
      secrets: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim() !== '')),
    }),
    onSuccess: () => { toast.success(`${i.label} saved`); void qc.invalidateQueries({ queryKey: ['admin-integrations'] }); onClose(); },
    onError: (e) => toast.error(errText(e, 'Could not save')),
  });
  const err = (k: string) => (tried ? errors[k] : undefined);
  return (
    <Modal open onClose={onClose} title={`${i.label} credentials`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button loading={save.isPending} disabled={save.isPending} onClick={() => { setTried(true); if (!Object.keys(errors).length) save.mutate(); }}>Save</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        {i.fields.config.map((f) => f.type === 'boolean' ? (
          <label key={f.key} className="flex items-center gap-2"><input type="checkbox" checked={Boolean(config[f.key])} onChange={(e) => setConfig({ ...config, [f.key]: e.target.checked })} /> {humanize(f.key)}</label>
        ) : f.type === 'choice' ? (
          <Select key={f.key} label={humanize(f.key)} value={String(config[f.key])} error={err(f.key)} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
            options={[{ value: '', label: 'Choose' }, ...(f.options ?? []).map((o) => ({ value: o, label: o }))]} />
        ) : (
          <Input key={f.key} label={`${humanize(f.key)}${f.required ? '' : ' (optional)'}`} type={f.type === 'number' ? 'number' : 'text'} value={String(config[f.key])} error={err(f.key)}
            onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
        ))}
        <div className="mt-1 border-t border-border pt-3 text-xs text-text-muted">Secrets are stored encrypted and never shown again. Leave a field empty to keep what is stored.</div>
        {i.fields.secrets.map((f) => (
          <Input key={f.key} label={humanize(f.key)} type="password" autoComplete="new-password" value={secrets[f.key] ?? ''} error={err(`s.${f.key}`)}
            hint={i.secrets[f.key] ? `Stored: ${i.secrets[f.key]}` : 'Not set'} onChange={(e) => setSecrets({ ...secrets, [f.key]: e.target.value })} />
        ))}
      </div>
    </Modal>
  );
}

function TestModal({ i, onClose }: { i: Integration; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const needsTo = i.kind !== 'payment';
  const [to, setTo] = useState('');
  const bad = needsTo && (i.kind === 'email' ? !/^\S+@\S+\.\S+$/.test(to.trim()) : to.replace(/\D/g, '').length < 10);
  const [tried, setTried] = useState(false);
  const test = useMutation({
    mutationFn: () => platformAdminApi.testIntegration(i.provider, needsTo ? to.trim() : undefined),
    onSuccess: (r) => { if (r.ok) toast.success(`${i.label}: test worked`); else toast.error(`${i.label}: ${r.error ?? 'test failed'}`); void qc.invalidateQueries({ queryKey: ['admin-integrations'] }); onClose(); },
    onError: (e) => toast.error(errText(e, 'Could not run the test')),
  });
  return (
    <Modal open onClose={onClose} title={`Test ${i.label}`}
      footer={<><Button variant="ghost" onClick={onClose} disabled={test.isPending}>Cancel</Button><Button loading={test.isPending} disabled={test.isPending} onClick={() => { setTried(true); if (!bad) test.mutate(); }}>Run test</Button></>}>
      {needsTo ? (
        <Input label={i.kind === 'email' ? 'Send a test email to' : 'Send a test message to (mobile)'} value={to} onChange={(e) => setTo(e.target.value)}
          error={tried && bad ? (i.kind === 'email' ? 'Enter an email address' : 'Enter a 10-digit mobile number') : undefined} />
      ) : <p className="text-sm text-text-muted">Checks the credentials with {i.label} — no money moves.</p>}
    </Modal>
  );
}
