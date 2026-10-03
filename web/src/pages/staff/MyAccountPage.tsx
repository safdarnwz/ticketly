import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, LogOut } from 'lucide-react';

import { Badge, Button, Card, CardBody, ErrorState, Input, PageLoader, usePaged, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { authApi } from '@/lib/api/auth';
import { reasonLabel, staffApi } from '@/lib/api/staff';
import { useAuth } from '@/stores/auth';
import { SectionTabs } from '@/components/common/SectionTabs';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

/**
 * My own account as a staff member: my roles and branch, my password, warnings
 * I have to read, my daily target, and what I did recently.
 */
export function MyAccountPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const logout = useAuth((s) => s.logout);
  const me = useQuery({ queryKey: ['me'], queryFn: staffApi.me });
  const ack = useMutation({
    mutationFn: staffApi.acknowledgeWarning,
    onSuccess: () => {
      toast.success('Marked as read');
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const everywhere = useMutation({
    mutationFn: authApi.logoutAll,
    onSuccess: () => {
      logout();
      navigate('/login');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });

  const activity = usePaged(me.data?.activity ?? []);
  if (me.isLoading) return <PageLoader />;
  if (me.isError || !me.data) return <ErrorState error={me.error} onRetry={me.refetch} />;
  const d = me.data;
  const unread = d.warnings.filter((w) => !w.acknowledgedAt);

  return (
    <>
      <PageHeader title="My account" subtitle={`${d.fullName} · ${d.email ?? ''}`} />
      {unread.length > 0 && (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-warning" /> You have {unread.length} warning{unread.length === 1 ? '' : 's'} to
          read.
        </div>
      )}
      <SectionTabs
        sections={[
          {
            key: 'access',
            label: 'Access',
            render: () => (
              <Card>
                <CardBody className="flex flex-col gap-2 text-sm">
                  <div className="font-semibold text-text">Access</div>
                  <div className="flex flex-wrap gap-1">
                    {d.roles.map((r) => (
                      <Badge key={r.id}>
                        {r.name}
                        {r.expiresAt ? ` · until ${formatDateTime(r.expiresAt)}` : ''}
                      </Badge>
                    ))}
                  </div>
                  <div className="text-text-muted">
                    Branch: {d.branchName ?? 'none'} · Reports to: {d.managerName ?? 'nobody'}
                  </div>
                  {d.accessExpiresAt && (
                    <div className="text-text-muted">Your access ends {formatDateTime(d.accessExpiresAt)}</div>
                  )}
                  {d.target && (
                    <div className="text-text-muted">
                      Daily target: {d.target.dailyBookings} bookings
                      {d.target.dailyRevenueMinor ? ` · ${formatMoney(d.target.dailyRevenueMinor, 'INR')}` : ''}
                    </div>
                  )}
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      leftIcon={<LogOut className="h-3.5 w-3.5" />}
                      loading={everywhere.isPending}
                      onClick={() => everywhere.mutate()}
                    >
                      Sign out on every device
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ),
          },
          { key: 'password', label: 'Password', render: () => <ChangePassword /> },
          {
            key: 'warnings',
            label: `Warnings${unread.length ? ` (${unread.length})` : ''}`,
            render: () => (
              <Card>
                <CardBody className="flex flex-col gap-2 text-sm">
                  <div className="font-semibold text-text">Warnings</div>
                  {d.warnings.length === 0 ? (
                    <p className="text-text-muted">None. Keep it up.</p>
                  ) : (
                    d.warnings.map((w) => (
                      <div
                        key={w.id}
                        className={cn(
                          'rounded-md border px-3 py-2',
                          w.acknowledgedAt ? 'border-border' : 'border-warning/50 bg-warning/5',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge tone="warning">{reasonLabel(w.reason)}</Badge>
                          <span className="text-text-muted">
                            {formatDateTime(w.issuedAt)}
                            {w.issuedByName ? ` · from ${w.issuedByName}` : ''}
                          </span>
                          {w.acknowledgedAt ? (
                            <span className="ml-auto text-success">Read</span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="ml-auto"
                              loading={ack.isPending && ack.variables === w.id}
                              disabled={ack.isPending}
                              onClick={() => ack.mutate(w.id)}
                            >
                              I have read this
                            </Button>
                          )}
                        </div>
                        <p className="mt-1 whitespace-pre-line">{w.note}</p>
                      </div>
                    ))
                  )}
                </CardBody>
              </Card>
            ),
          },
          {
            key: 'activity',
            label: 'Activity',
            render: () => (
              <Card>
                <CardBody className="text-sm">
                  <div className="mb-2 font-semibold text-text">What I did recently</div>
                  {d.activity.length === 0 ? (
                    <p className="text-text-muted">Nothing recorded yet.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {activity.pageItems.map((a, i) => (
                        <li key={i} className="flex justify-between gap-3 px-3 py-1.5">
                          <span>
                            <span className="font-mono text-xs">{a.action}</span>{' '}
                            <span className="text-text-muted">{a.resourceType}</span>
                          </span>
                          <span className="shrink-0 text-xs text-text-muted">{formatDateTime(a.occurredAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {activity.pager}
                </CardBody>
              </Card>
            ),
          },
        ]}
      />
    </>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [tried, setTried] = useState(false);
  const errors: Record<string, string> = {};
  if (!current) errors.current = 'Enter your current password';
  if (next.length < 8) errors.next = 'At least 8 characters';
  else if (next === current) errors.next = 'Pick a different password';
  if (again !== next) errors.again = 'The two passwords differ';
  const save = useMutation({
    mutationFn: () => authApi.changePassword(current, next),
    onSuccess: () => {
      toast.success('Password changed — your other devices were signed out');
      setCurrent('');
      setNext('');
      setAgain('');
      setTried(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const err = (k: string) => (tried ? errors[k] : undefined);
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center gap-1.5 font-semibold text-text">
          <KeyRound className="h-4 w-4" /> Change password
        </div>
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          error={err('current')}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          error={err('next')}
          onChange={(e) => setNext(e.target.value)}
        />
        <Input
          label="New password again"
          type="password"
          autoComplete="new-password"
          value={again}
          error={err('again')}
          onChange={(e) => setAgain(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            loading={save.isPending}
            disabled={save.isPending}
            onClick={() => {
              setTried(true);
              if (Object.keys(errors).length === 0) save.mutate();
            }}
          >
            Change password
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
