import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge, Button, ErrorState, Input, Modal, PageLoader, Select, useToast, usePaged } from '@/components/ui';
import { platformAdminApi, type OperatorDetail } from '@/lib/api/platformAdmin';
import { tenantsApi } from '@/lib/api/tenants';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const FAVICON_TYPES = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml'];

/**
 * One operator's platform settings (#4, #58–#62, #67): its own booking
 * domain, white-label favicon, API rate limit, and features switched on or off
 * for it alone (otherwise its plan decides).
 */
export function OperatorSettingsModal({ tenantId, name, onClose }: { tenantId: string; name: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['operator-detail', tenantId], queryFn: () => platformAdminApi.operator(tenantId) });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${name} — platform settings`}
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
        <div className="flex flex-col gap-5 text-sm">
          <DomainSection d={q.data!} />
          <RateSection d={q.data!} />
          <FaviconSection d={q.data!} />
          <FeaturesSection d={q.data!} />
        </div>
      )}
    </Modal>
  );
}

function useRefresh(id: string) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['operator-detail', id] });
}

function DomainSection({ d }: { d: OperatorDetail }) {
  const toast = useToast();
  const refresh = useRefresh(d.id);
  const [v, setV] = useState(d.primaryDomain ?? '');
  const clean = v.trim().toLowerCase();
  const e = clean && !DOMAIN.test(clean) ? 'A host name like book.example.com' : undefined;
  const save = useMutation({
    mutationFn: (domain: string | null) => platformAdminApi.setDomain(d.id, domain),
    onSuccess: (_, domain) => {
      toast.success(domain ? `Customers can book at ${domain} once its DNS points here` : 'Custom domain removed');
      refresh();
    },
    onError: (x) => toast.error(errText(x, 'Could not save the domain')),
  });
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-text">Booking domain</h3>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <Input
            aria-label="Custom domain"
            placeholder="book.orangetravels.in"
            value={v}
            error={e}
            onChange={(x) => setV(x.target.value)}
          />
        </div>
        <Button
          loading={save.isPending}
          disabled={save.isPending || !!e || !clean || clean === d.primaryDomain}
          onClick={() => save.mutate(clean)}
        >
          Save
        </Button>
        {d.primaryDomain && (
          <Button
            variant="ghost"
            disabled={save.isPending}
            onClick={() => {
              setV('');
              save.mutate(null);
            }}
          >
            Remove
          </Button>
        )}
      </div>
      <p className="text-xs text-text-muted">
        The operator's own site for customers. A domain already used by another operator is refused.
      </p>
    </section>
  );
}

function RateSection({ d }: { d: OperatorDetail }) {
  const toast = useToast();
  const refresh = useRefresh(d.id);
  const [v, setV] = useState(d.apiRateLimit === null ? '' : String(d.apiRateLimit));
  const n = Number(v);
  const e =
    v.trim() !== '' && (!Number.isInteger(n) || n < 10 || n > 1_000_000) ? '10 to 1,000,000 requests a minute' : undefined;
  const save = useMutation({
    mutationFn: () => platformAdminApi.setRateLimit(d.id, v.trim() === '' ? null : n),
    onSuccess: () => {
      toast.success(v.trim() === '' ? 'Back to the platform default' : `Limited to ${n} requests a minute`);
      refresh();
    },
    onError: (x) => toast.error(errText(x, 'Could not save')),
  });
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-text">API rate limit</h3>
      <div className="flex items-start gap-2">
        <div className="w-56">
          <Input
            aria-label="Requests per minute"
            type="number"
            placeholder="Platform default"
            value={v}
            error={e}
            onChange={(x) => setV(x.target.value)}
          />
        </div>
        <Button
          loading={save.isPending}
          disabled={save.isPending || !!e || (v.trim() === '' ? d.apiRateLimit === null : n === d.apiRateLimit)}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
      <p className="text-xs text-text-muted">
        Requests a minute for this operator's API and partner keys. Empty = platform default.
      </p>
    </section>
  );
}

function FaviconSection({ d }: { d: OperatorDetail }) {
  const toast = useToast();
  const refresh = useRefresh(d.id);
  const [err, setErr] = useState<string>();
  const save = useMutation({
    mutationFn: (uri: string | null) => platformAdminApi.setFavicon(d.id, uri),
    onSuccess: (_, uri) => {
      toast.success(uri ? 'Favicon set' : 'Favicon removed');
      refresh();
    },
    onError: (x) => toast.error(errText(x, 'Could not save the favicon')),
  });
  const pick = (file: File | undefined) => {
    setErr(undefined);
    if (!file) return;
    if (!FAVICON_TYPES.includes(file.type)) return setErr('Use a PNG, ICO or SVG file');
    if (file.size > 100_000) return setErr('At most 100 KB');
    const r = new FileReader();
    r.onload = () => save.mutate(String(r.result));
    r.onerror = () => setErr('Could not read the file');
    r.readAsDataURL(file);
  };
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-text">
        Favicon <Badge tone={d.hasFavicon ? 'success' : 'neutral'}>{d.hasFavicon ? 'set' : 'none'}</Badge>
      </h3>
      <div className="flex items-center gap-2">
        <input
          aria-label="Favicon file"
          type="file"
          accept=".png,.ico,.svg,image/png,image/x-icon,image/svg+xml"
          disabled={save.isPending}
          onChange={(x) => pick(x.target.files?.[0])}
        />
        {d.hasFavicon && (
          <Button size="sm" variant="ghost" loading={save.isPending} disabled={save.isPending} onClick={() => save.mutate(null)}>
            Remove
          </Button>
        )}
      </div>
      {err && (
        <p role="alert" className="text-xs text-danger">
          {err}
        </p>
      )}
    </section>
  );
}

function FeaturesSection({ d }: { d: OperatorDetail }) {
  const toast = useToast();
  const refresh = useRefresh(d.id);
  const plans = useQuery({ queryKey: ['tenant-plans'], queryFn: tenantsApi.plans });
  const keys = [
    ...new Set([
      ...(plans.data?.items ?? []).flatMap((p) => Object.keys(p.features ?? {})),
      ...Object.keys(d.plan?.features ?? {}),
      ...Object.keys(d.featureOverrides),
    ]),
  ].sort();
  const set = useMutation({
    mutationFn: ({ key, value }: { key: string; value: boolean | null }) => platformAdminApi.setFeature(d.id, key, value),
    onSuccess: (_, { key, value }) => {
      toast.success(value === null ? `${key}: follows the plan again` : `${key} ${value ? 'on' : 'off'} for ${d.displayName}`);
      refresh();
    },
    onError: (x) => toast.error(errText(x, 'Could not change it')),
  });
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-text">Features</h3>
      <p className="text-xs text-text-muted">
        Plan: <b>{d.plan?.name ?? 'none'}</b>. Switch a feature on or off for this operator only; “Plan” follows the plan.
      </p>
      {keys.length > 0 && <RollbackRow keys={keys} onDone={refresh} />}
      {plans.isLoading ? (
        <PageLoader />
      ) : keys.length === 0 ? (
        <p className="text-text-muted">No features defined on any plan.</p>
      ) : (
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {keys.map((k) => {
            const override = d.featureOverrides[k];
            const fromPlan = Boolean(d.plan?.features?.[k]);
            const value = override === undefined ? 'plan' : override ? 'on' : 'off';
            return (
              <div key={k} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
                <span className="font-mono text-xs">
                  {k} <span className="text-text-muted">({value === 'plan' ? (fromPlan ? 'on' : 'off') : value})</span>
                </span>
                <Select
                  aria-label={`Feature ${k}`}
                  value={value}
                  disabled={set.isPending}
                  onChange={(x) => set.mutate({ key: k, value: x.target.value === 'plan' ? null : x.target.value === 'on' })}
                  options={[
                    { value: 'plan', label: `Plan (${fromPlan ? 'on' : 'off'})` },
                    { value: 'on', label: 'On' },
                    { value: 'off', label: 'Off' },
                  ]}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Global rollback (#60): clear one feature's override from EVERY operator — all follow their plan again. */
function RollbackRow({ keys, onDone }: { keys: string[]; onDone: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState('');
  const go = useMutation({
    mutationFn: () => platformAdminApi.rollbackFeature(key),
    onSuccess: (r) => {
      toast.success(`${key}: ${r.operatorsAffected} operator${r.operatorsAffected === 1 ? '' : 's'} back on their plan`);
      setKey('');
      onDone();
    },
    onError: (x) => toast.error(errText(x, 'Could not roll back')),
  });
  return (
    <div className="flex items-end gap-2 rounded-md bg-surface-muted p-2">
      <div className="w-56">
        <Select
          label="Roll back for every operator"
          value={key}
          onChange={(x) => setKey(x.target.value)}
          options={[{ value: '', label: 'Choose a feature' }, ...keys.map((k) => ({ value: k, label: k }))]}
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        loading={go.isPending}
        disabled={!key || go.isPending}
        onClick={() => {
          if (window.confirm(`Remove every operator's own setting for “${key}”? They all follow their plan again.`)) go.mutate();
        }}
      >
        Roll back
      </Button>
    </div>
  );
}

/** Tell every operator (or only active / suspended ones) something, by email (#108). */
export function BroadcastModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ['broadcasts'], queryFn: platformAdminApi.broadcasts });
  const historyPage = usePaged(history.data?.items ?? []);
  const [key] = useState(() => `bc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [f, setF] = useState({ subject: '', body: '', audience: 'active' });
  const [tried, setTried] = useState(false);
  const e = {
    subject: f.subject.trim().length < 3 ? 'At least 3 characters' : undefined,
    body: f.body.trim().length < 3 ? 'Write the message' : undefined,
  };
  const send = useMutation({
    mutationFn: () => platformAdminApi.broadcast({ subject: f.subject.trim(), body: f.body.trim(), audience: f.audience }, key),
    onSuccess: (r) => {
      toast.success(
        `Sent to ${r.sent} of ${r.recipients} operator${r.recipients === 1 ? '' : 's'}${r.failed ? ` · ${r.failed} failed` : ''}`,
      );
      void qc.invalidateQueries({ queryKey: ['broadcasts'] });
      onClose();
    },
    onError: (x) => toast.error(errText(x, 'Could not send')),
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Message all operators"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button
            loading={send.isPending}
            disabled={send.isPending}
            onClick={() => {
              setTried(true);
              if (!e.subject && !e.body && window.confirm('Send this email to every operator in the audience?')) send.mutate();
            }}
          >
            Send
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <Select
          label="To"
          value={f.audience}
          onChange={(x) => setF({ ...f, audience: x.target.value })}
          options={[
            { value: 'active', label: 'Active operators' },
            { value: 'all', label: 'Every operator' },
            { value: 'suspended', label: 'Suspended operators' },
          ]}
        />
        <Input
          label="Subject"
          value={f.subject}
          maxLength={150}
          error={tried ? e.subject : undefined}
          onChange={(x) => setF({ ...f, subject: x.target.value })}
        />
        <label className="flex flex-col gap-1">
          <span className="font-medium text-text">Message</span>
          <textarea
            className="min-h-32 rounded-md border border-border bg-surface p-2"
            maxLength={5000}
            value={f.body}
            aria-invalid={tried && !!e.body}
            onChange={(x) => setF({ ...f, body: x.target.value })}
          />
          {tried && e.body && (
            <span role="alert" className="text-xs text-danger">
              {e.body}
            </span>
          )}
        </label>
        <div className="border-t border-border pt-2">
          <div className="mb-1 font-medium text-text">Sent before</div>
          {history.isLoading ? (
            <PageLoader />
          ) : (history.data?.items ?? []).length === 0 ? (
            <p className="text-text-muted">Nothing sent yet.</p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-xs">
              {historyPage.pageItems.map((h) => (
                <li key={h.id}>
                  <b>{h.subject}</b> · {h.audience} · {h.sent}/{h.recipients} sent · {new Date(h.createdAt).toLocaleString()}
                </li>
              ))}
              <li className="list-none">{historyPage.pager}</li>
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
