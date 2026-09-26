import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';

import { Button, Card, CardBody, ErrorState, Input, PageLoader, Select, useToast } from '@/components/ui';
import { ApiError } from '@/lib/api/client';
import { operatorProfileApi, type OperatorProfile } from '@/lib/api/operatorProfile';

const MOBILE = /^(\+?91)?[6-9]\d{9}$/;
const clean = (v: string) => v.replace(/[\s-]/g, '');
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Colombo'];

/** Your company as customers and invoices see it: name, who to call, where you are. */
export function CompanyProfilePage() {
  const q = useQuery({ queryKey: ['operator-profile'], queryFn: operatorProfileApi.get });
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <ProfileForm profile={q.data} />;
}

function ProfileForm({ profile }: { profile: OperatorProfile }) {
  const qc = useQueryClient();
  const toast = useToast();
  const init = () => ({
    displayName: profile.displayName, contactEmail: profile.contactEmail, contactPhone: profile.contactPhone ?? '', timezone: profile.timezone,
    secName: profile.secondaryContact?.name ?? '', secPhone: profile.secondaryContact?.phone ?? '', secEmail: profile.secondaryContact?.email ?? '',
    line1: profile.address?.line1 ?? '', line2: profile.address?.line2 ?? '', city: profile.address?.city ?? '', state: profile.address?.state ?? '', pincode: profile.address?.pincode ?? '',
  });
  const [f, setF] = useState(init);
  useEffect(() => setF(init()), [profile]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof ReturnType<typeof init>, v: string) => setF((x) => ({ ...x, [k]: v }));
  const hasSecondary = !!(f.secName || f.secPhone || f.secEmail);
  const hasAddress = !!(f.line1 || f.city || f.state || f.pincode || f.line2);
  const e: Record<string, string> = {};
  if (f.displayName.trim().length < 2) e.displayName = 'At least 2 characters';
  if (!/^\S+@\S+\.\S+$/.test(f.contactEmail.trim())) e.contactEmail = 'A valid email';
  if (!MOBILE.test(clean(f.contactPhone))) e.contactPhone = 'A 10-digit mobile';
  if (hasSecondary) {
    if (f.secName.trim().length < 2) e.secName = 'Their name';
    if (!MOBILE.test(clean(f.secPhone))) e.secPhone = 'A 10-digit mobile';
    else if (clean(f.secPhone).slice(-10) === clean(f.contactPhone).slice(-10)) e.secPhone = 'Same as the main number';
    if (f.secEmail && !/^\S+@\S+\.\S+$/.test(f.secEmail.trim())) e.secEmail = 'A valid email';
  }
  if (hasAddress) {
    if (f.line1.trim().length < 3) e.line1 = 'Building and street';
    if (f.city.trim().length < 2) e.city = 'City';
    if (f.state.trim().length < 2) e.state = 'State';
    if (!/^[1-9]\d{5}$/.test(f.pincode.trim())) e.pincode = 'A 6-digit PIN code';
  }
  const save = useMutation({
    mutationFn: () => operatorProfileApi.update({
      displayName: f.displayName.trim(), contactEmail: f.contactEmail.trim(), contactPhone: clean(f.contactPhone), timezone: f.timezone,
      secondaryContact: hasSecondary ? { name: f.secName.trim(), phone: clean(f.secPhone), email: f.secEmail.trim() || undefined } : null,
      ...(hasAddress ? { address: { line1: f.line1.trim(), line2: f.line2.trim() || undefined, city: f.city.trim(), state: f.state.trim(), pincode: f.pincode.trim() } } : {}),
    }),
    onSuccess: () => { toast.success('Company profile saved'); void qc.invalidateQueries({ queryKey: ['operator-profile'] }); },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed'),
  });
  const server = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const err = (k: string, sk?: string) => e[k] ?? (sk ? server[sk] : undefined);
  const dirty = JSON.stringify(f) !== JSON.stringify(init());
  return (
    <div className="flex flex-col gap-4">
      <Card><CardBody className="grid grid-cols-2 gap-3 text-sm">
        <div className="col-span-2 flex items-center gap-2 font-semibold text-text"><Building2 className="h-4 w-4" /> Company</div>
        <Input label="Name customers see" value={f.displayName} error={err('displayName', 'displayName')} onChange={(x) => set('displayName', x.target.value)} />
        <Select label="Time zone" value={f.timezone} onChange={(x) => set('timezone', x.target.value)} options={[...new Set([profile.timezone, ...TIMEZONES])].map((t) => ({ label: t, value: t }))} />
        <div><div className="text-xs text-text-muted">Legal name (on invoices)</div><div className="font-medium">{profile.legalName}</div></div>
        <div><div className="text-xs text-text-muted">GSTIN</div><div className="font-mono">{profile.gstin ?? '—'}</div></div>
        <p className="col-span-2 text-xs text-text-muted">Legal name and GSTIN are verified by Ticketly — write to support to change them.</p>
      </CardBody></Card>
      <Card><CardBody className="grid grid-cols-2 gap-3">
        <div className="col-span-2 font-semibold text-text">Contacts</div>
        <Input label="Main email" value={f.contactEmail} error={err('contactEmail', 'contactEmail')} onChange={(x) => set('contactEmail', x.target.value)} />
        <Input label="Main mobile" value={f.contactPhone} error={err('contactPhone', 'contactPhone')} onChange={(x) => set('contactPhone', x.target.value)} />
        <Input label="Second contact name (optional)" value={f.secName} error={err('secName', 'secondaryContact.name')} onChange={(x) => set('secName', x.target.value)} />
        <Input label="Second contact mobile" value={f.secPhone} error={err('secPhone', 'secondaryContact.phone')} onChange={(x) => set('secPhone', x.target.value)} />
        <Input label="Second contact email (optional)" value={f.secEmail} error={err('secEmail', 'secondaryContact.email')} onChange={(x) => set('secEmail', x.target.value)} />
        {hasSecondary && <div className="flex items-end"><Button size="sm" variant="ghost" onClick={() => setF((x) => ({ ...x, secName: '', secPhone: '', secEmail: '' }))}>Remove second contact</Button></div>}
      </CardBody></Card>
      <Card><CardBody className="grid grid-cols-2 gap-3">
        <div className="col-span-2 font-semibold text-text">Registered address <span className="text-xs font-normal text-text-muted">— printed on your tax invoices</span></div>
        <Input label="Building and street" value={f.line1} error={err('line1', 'address.line1')} onChange={(x) => set('line1', x.target.value)} />
        <Input label="Area / landmark (optional)" value={f.line2} onChange={(x) => set('line2', x.target.value)} />
        <Input label="City" value={f.city} error={err('city', 'address.city')} onChange={(x) => set('city', x.target.value)} />
        <Input label="State" value={f.state} error={err('state', 'address.state')} onChange={(x) => set('state', x.target.value)} />
        <Input label="PIN code" value={f.pincode} maxLength={6} error={err('pincode', 'address.pincode')} onChange={(x) => set('pincode', x.target.value)} />
        {!profile.address && profile.registeredAddress && <p className="col-span-2 text-xs text-text-muted">On file: {profile.registeredAddress}</p>}
      </CardBody></Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setF(init())}>Undo changes</Button>
        <Button loading={save.isPending} disabled={!dirty || save.isPending || Object.keys(e).length > 0} onClick={() => save.mutate()}>Save profile</Button>
      </div>
    </div>
  );
}
