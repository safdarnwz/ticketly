import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, User, ShieldAlert, Star, Table as TableIcon } from 'lucide-react';

import { Button, Card, CardBody, Badge, Table, type Column, Modal, Input, PageLoader, EmptyState, useToast } from '@/components/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { crmApi, type CustomerProfile } from '@/lib/api/crm';
import { formatMoney } from '@/lib/utils';

export function CustomersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [viewing, setViewing] = useState<CustomerProfile | null>(null);
  const [blacklisting, setBlacklisting] = useState(false);
  const [reason, setReason] = useState('');
  const [prefsText, setPrefsText] = useState('');

  const results = useQuery({ queryKey: ['customer-search', searched], queryFn: () => crmApi.search(searched), enabled: !!searched });
  const bookings = useQuery({ queryKey: ['customer-bookings', viewing?.id], queryFn: () => crmApi.bookings(viewing!.id), enabled: !!viewing });

  const blacklist = useMutation({
    mutationFn: () => crmApi.blacklist(viewing!.id, reason),
    onSuccess: () => { toast.success('Customer blacklisted — cannot make new bookings'); setBlacklisting(false); setReason(''); setViewing(null); void qc.invalidateQueries({ queryKey: ['customer-search'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const unblacklist = useMutation({
    mutationFn: () => crmApi.unblacklist(viewing!.id),
    onSuccess: () => { toast.success('Removed from blacklist'); setViewing(null); void qc.invalidateQueries({ queryKey: ['customer-search'] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  });
  const savePrefs = useMutation({
    mutationFn: () => crmApi.setPreferences(viewing!.id, JSON.parse(prefsText || '{}')),
    onSuccess: () => { toast.success('Preferences saved'); },
    onError: () => toast.error('Invalid JSON'),
  });

  const columns: Column<CustomerProfile>[] = [
    { key: 'name', header: 'Name', render: (c) => <button className="font-medium text-text underline decoration-dotted" onClick={() => { setViewing(c); setPrefsText(JSON.stringify(c.preferences ?? {}, null, 2)); }}>{c.fullName ?? '—'}</button> },
    { key: 'contact', header: 'Contact', render: (c) => <span className="text-text-muted">{c.phone ?? c.email ?? '—'}</span> },
    { key: 'bookings', header: 'Bookings', render: (c) => <span className="flex items-center gap-1">{c.totalBookings}{c.isFrequentTraveller && <Star className="h-3.5 w-3.5 text-warning" />}</span> },
    { key: 'spent', header: 'Total spent', render: (c) => formatMoney(c.totalSpentMinor, 'INR') },
    { key: 'status', header: 'Status', render: (c) => c.blacklistedAt ? <Badge tone="danger">Blacklisted</Badge> : <Badge tone="success">Good standing</Badge> },
  ];

  return (
    <>
      <PageHeader title="Customers" subtitle="Search by name, or exact phone/email" />

      <Card className="mb-6">
        <CardBody>
          <form onSubmit={(e) => { e.preventDefault(); setSearched(query); }} className="flex gap-2">
            <div className="flex-1"><Input label="Search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, phone, or email" /></div>
            <Button type="submit" leftIcon={<Search className="h-4 w-4" />}>Search</Button>
          </form>
        </CardBody>
      </Card>

      {results.isLoading ? <PageLoader /> : searched ? (
        results.data?.items.length ? <Table columns={columns} rows={results.data.items} /> : <EmptyState title="No customers found" icon={<User className="h-10 w-10" />} />
      ) : <EmptyState title="Search for a customer to see their profile" icon={<Search className="h-10 w-10" />} />}

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.fullName ?? 'Customer'} size="lg">
        {viewing && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="text-text-muted">Phone</div><div className="font-medium text-text">{viewing.phone ?? '—'}</div></div>
              <div><div className="text-text-muted">Email</div><div className="font-medium text-text">{viewing.email ?? '—'}</div></div>
              <div><div className="text-text-muted">Total spent</div><div className="font-medium text-text">{formatMoney(viewing.totalSpentMinor, 'INR')}</div></div>
            </div>

            {viewing.blacklistedAt ? (
              <Card className="border-danger/40"><CardBody className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-danger"><ShieldAlert className="h-4 w-4" /> Blacklisted{viewing.blacklistReason ? `: ${viewing.blacklistReason}` : ''}</div>
                <Button size="sm" variant="outline" loading={unblacklist.isPending} onClick={() => unblacklist.mutate()}>Remove from blacklist</Button>
              </CardBody></Card>
            ) : (
              <Button size="sm" variant="outline" className="self-start text-danger" leftIcon={<ShieldAlert className="h-4 w-4" />} onClick={() => setBlacklisting(true)}>Blacklist this customer</Button>
            )}

            <div>
              <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-text"><TableIcon className="h-4 w-4" /> Booking history</div>
              {bookings.isLoading ? <PageLoader /> : (
                <div className="flex flex-col gap-1 text-sm">
                  {(bookings.data?.items ?? []).map((b) => (
                    <div key={b.id} className="flex justify-between border-b border-border py-1.5">
                      <span className="font-mono text-xs">{b.pnr}</span>
                      <Badge>{b.status}</Badge>
                      <span>{formatMoney(b.totalMinor, 'INR')}</span>
                      <span className="text-text-muted">{new Date(b.createdAt).toLocaleDateString()}</span>
                    </div>
                  ))}
                  {!bookings.data?.items.length && <p className="text-text-muted">No bookings yet.</p>}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold text-text">Preferences (JSON)</div>
              <textarea value={prefsText} onChange={(e) => setPrefsText(e.target.value)} rows={5}
                className="w-full rounded-md border border-border bg-surface-muted p-3 font-mono text-xs text-text" spellCheck={false} />
              <Button size="sm" className="mt-2" loading={savePrefs.isPending} onClick={() => savePrefs.mutate()}>Save preferences</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={blacklisting} onClose={() => setBlacklisting(false)} title="Blacklist customer"
        footer={<><Button variant="ghost" onClick={() => setBlacklisting(false)}>Cancel</Button><Button variant="danger" loading={blacklist.isPending} disabled={!reason.trim()} onClick={() => blacklist.mutate()}>Blacklist</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">They will be blocked from making NEW bookings. Existing bookings and history remain visible to support.</p>
          <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Repeated no-shows" />
        </div>
      </Modal>
    </>
  );
}
