import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Lock, ShieldAlert, Network } from 'lucide-react';

import { Badge, Button, Card, CardBody, CardHeader, ErrorState, Input, PageLoader, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { SectionTabs } from '@/components/common/SectionTabs';
import { platformAdminApi, type PasswordPolicy, type Policies, type SuspiciousLoginPolicy } from '@/lib/api/platformAdmin';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const IP_OR_CIDR = /^(\d{1,3})(\.\d{1,3}){3}(\/\d{1,2})?$|^[0-9a-fA-F:]+(\/\d{1,3})?$/;

/**
 * Who may sign in and how (#26–#30, #54, #120): the password rules every
 * account follows, the addresses platform admins may sign in from, alerts on
 * suspicious sign-ins, and the encryption of stored personal data.
 */
export function SecurityPage() {
  const q = useQuery({ queryKey: ['admin-policies'], queryFn: platformAdminApi.policies });
  return (
    <>
      <PageHeader title="Security" subtitle="Password rules, admin sign-in addresses, sign-in alerts and data encryption" />
      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : (
        <SectionTabs
          sections={[
            { key: 'password', label: 'Password rules', render: () => <PasswordCard p={q.data!.password} /> },
            { key: 'ip', label: 'Admin IPs', render: () => <IpCard entries={q.data!.adminIpAllowlist} /> },
            { key: 'alerts', label: 'Sign-in alerts', render: () => <SuspiciousCard p={q.data!.suspiciousLogin} /> },
            { key: 'encryption', label: 'Encryption', render: () => <EncryptionCard /> },
          ]}
        />
      )}
    </>
  );
}

function useSave<T>(fn: (v: T) => Promise<unknown>, ok: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(ok);
      void qc.invalidateQueries({ queryKey: ['admin-policies'] });
    },
    onError: (e) => toast.error(errText(e, 'Could not save')),
  });
}

function PasswordCard({ p }: { p: PasswordPolicy }) {
  const [f, setF] = useState({ ...p, minLength: String(p.minLength), expiryDays: String(p.expiryDays) });
  const save = useSave(
    (v: Policies['password']) => platformAdminApi.setPassword(v),
    'Password rules saved — they apply to the next password set',
  );
  const min = Number(f.minLength);
  const exp = Number(f.expiryDays);
  const e = {
    minLength: !Number.isInteger(min) || min < 8 || min > 128 ? '8 to 128 characters' : undefined,
    expiryDays: !Number.isInteger(exp) || exp < 0 || exp > 3650 ? '0 (never) to 3650 days' : undefined,
  };
  const box = (k: 'requireUppercase' | 'requireLowercase' | 'requireDigit' | 'requireSymbol', label: string) => (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={f[k]} onChange={(x) => setF({ ...f, [k]: x.target.checked })} /> {label}
    </label>
  );
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> Password rules
          </span>
        }
        subtitle="For every account on the platform"
      />
      <CardBody className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Minimum length"
            type="number"
            min={8}
            max={128}
            value={f.minLength}
            error={e.minLength}
            onChange={(x) => setF({ ...f, minLength: x.target.value })}
          />
          <Input
            label="Expires after (days)"
            type="number"
            min={0}
            max={3650}
            value={f.expiryDays}
            error={e.expiryDays}
            hint="0 = never"
            onChange={(x) => setF({ ...f, expiryDays: x.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {box('requireUppercase', 'An upper-case letter')}
          {box('requireLowercase', 'A lower-case letter')}
          {box('requireDigit', 'A digit')}
          {box('requireSymbol', 'A symbol')}
        </div>
        <Button
          className="self-start"
          loading={save.isPending}
          disabled={save.isPending || !!e.minLength || !!e.expiryDays}
          onClick={() => save.mutate({ ...f, minLength: min, expiryDays: exp })}
        >
          Save
        </Button>
      </CardBody>
    </Card>
  );
}

function IpCard({ entries }: { entries: string[] }) {
  const [text, setText] = useState(entries.join('\n'));
  const list = text
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const bad = list.filter((x) => !IP_OR_CIDR.test(x));
  const save = useSave(
    (v: string[]) => platformAdminApi.setIpAllowlist(v),
    list.length ? 'Only these addresses can open the admin console now' : 'Admin console open from any address',
  );
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Network className="h-4 w-4" /> Admin sign-in addresses
          </span>
        }
        subtitle="Empty = any address. Your own address must be on the list."
      />
      <CardBody className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium text-text">IP addresses or ranges (one per line)</span>
          <textarea
            className="min-h-28 rounded-md border border-border bg-surface p-2 font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'203.0.113.10\n198.51.100.0/24'}
            aria-invalid={bad.length > 0}
          />
        </label>
        {bad.length > 0 && (
          <p role="alert" className="text-xs text-danger">
            Not an IP address or range: {bad.join(', ')}
          </p>
        )}
        <Button
          className="self-start"
          loading={save.isPending}
          disabled={save.isPending || bad.length > 0 || list.length > 200}
          onClick={() => {
            if (
              list.length === 0 ||
              window.confirm('Only these addresses will reach the admin console. Is your current address on the list?')
            )
              save.mutate(list);
          }}
        >
          Save
        </Button>
      </CardBody>
    </Card>
  );
}

function SuspiciousCard({ p }: { p: SuspiciousLoginPolicy }) {
  const [f, setF] = useState({
    ...p,
    failedAttemptsThreshold: String(p.failedAttemptsThreshold),
    windowMinutes: String(p.windowMinutes),
    alertEmails: p.alertEmails.join(', '),
  });
  const save = useSave((v: SuspiciousLoginPolicy) => platformAdminApi.setSuspiciousLogin(v), 'Sign-in alerts saved');
  const n = Number(f.failedAttemptsThreshold);
  const w = Number(f.windowMinutes);
  const emails = f.alertEmails.split(/[\s,]+/).filter(Boolean);
  const e = {
    n: !Number.isInteger(n) || n < 2 || n > 100 ? '2 to 100' : undefined,
    w: !Number.isInteger(w) || w < 1 || w > 1440 ? '1 to 1440 minutes' : undefined,
    emails: emails.some((x) => !/^\S+@\S+\.\S+$/.test(x))
      ? 'Check the email addresses'
      : f.enabled && emails.length === 0
        ? 'Who gets the alert?'
        : undefined,
  };
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Suspicious sign-in alerts
          </span>
        }
        subtitle="Accounts lock after repeated wrong passwords either way"
      />
      <CardBody className="flex flex-col gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.enabled} onChange={(x) => setF({ ...f, enabled: x.target.checked })} /> Send alerts
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Failed attempts"
            type="number"
            value={f.failedAttemptsThreshold}
            error={e.n}
            onChange={(x) => setF({ ...f, failedAttemptsThreshold: x.target.value })}
          />
          <Input
            label="Within (minutes)"
            type="number"
            value={f.windowMinutes}
            error={e.w}
            onChange={(x) => setF({ ...f, windowMinutes: x.target.value })}
          />
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={f.alertOnNewAdminIp}
            onChange={(x) => setF({ ...f, alertOnNewAdminIp: x.target.checked })}
          />{' '}
          Alert when an admin signs in from a new address
        </label>
        <Input
          label="Send alerts to"
          value={f.alertEmails}
          error={e.emails}
          placeholder="security@ticketly.com, cto@ticketly.com"
          onChange={(x) => setF({ ...f, alertEmails: x.target.value })}
        />
        <Button
          className="self-start"
          loading={save.isPending}
          disabled={save.isPending || !!e.n || !!e.w || !!e.emails}
          onClick={() =>
            save.mutate({
              enabled: f.enabled,
              failedAttemptsThreshold: n,
              windowMinutes: w,
              alertOnNewAdminIp: f.alertOnNewAdminIp,
              alertEmails: emails,
            })
          }
        >
          Save
        </Button>
      </CardBody>
    </Card>
  );
}

function EncryptionCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin-encryption'], queryFn: platformAdminApi.encryption });
  const go = useMutation({
    mutationFn: platformAdminApi.reencrypt,
    onSuccess: (r) => {
      toast.success(
        `Re-encrypted ${r.rewritten} record${r.rewritten === 1 ? '' : 's'}${r.remaining ? ` — ${r.remaining} left, run again` : ''}`,
      );
      void qc.invalidateQueries({ queryKey: ['admin-encryption'] });
    },
    onError: (e) => toast.error(errText(e, 'Could not re-encrypt')),
  });
  const s = q.data;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Encryption keys
          </span>
        }
        subtitle="Personal data and credentials are encrypted at rest"
      />
      <CardBody className="flex flex-col gap-3 text-sm">
        {q.isLoading ? (
          <PageLoader />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={q.refetch} />
        ) : (
          s && (
            <>
              <div className="flex items-center gap-2">
                {s.enabled ? <Badge tone="success">on</Badge> : <Badge tone="danger">off</Badge>} Current key{' '}
                <b className="font-mono">{s.currentKeyId ?? '—'}</b>
              </div>
              <div className="text-text-muted">
                Accounts by key:{' '}
                {Object.entries(s.users)
                  .map(([k, n]) => `${k}: ${n}`)
                  .join(' · ') || '—'}
              </div>
              <div className={s.remaining ? 'text-warning' : 'text-success'}>
                {s.remaining
                  ? `${s.remaining} record${s.remaining === 1 ? '' : 's'} not on the current key`
                  : 'Everything is on the current key'}
              </div>
              <p className="text-xs text-text-muted">
                To rotate: deploy with a new key (the old one kept as a previous key), then re-encrypt here until nothing is left.
              </p>
              <Button
                className="self-start"
                variant="outline"
                loading={go.isPending}
                disabled={go.isPending || !s.enabled || s.remaining === 0}
                onClick={() => go.mutate()}
              >
                Re-encrypt with the current key
              </Button>
            </>
          )
        )}
      </CardBody>
    </Card>
  );
}
