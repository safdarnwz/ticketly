import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, CheckCircle2 } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Input, useToast } from '@/components/ui';
import { onboardingApi, type OperatorApplication } from '@/lib/api/onboarding';
import { KycVerificationSection } from '@/components/onboarding/KycVerificationSection';
import { IfscInput, PincodeInput } from '@/components/forms/LookupInputs';
import { ApiError } from '@/lib/api/client';

const empty: OperatorApplication = {
  firstName: '', lastName: '', email: '', mobile: '', designation: '', password: '',
  companyName: '', companyType: '', gstNumber: '', panNumber: '', registrationNumber: '',
  officialEmail: '', companyMobile: '', website: '',
  addressLine1: '', addressLine2: '', city: '', state: '', country: 'India', pinCode: '',
  bankAccountHolder: '', bankAccountNumber: '', bankIfsc: '', bankName: '',
  business: { numberOfBuses: undefined, busTypes: [], cities: [], yearsInBusiness: undefined, dailyTrips: undefined },
};

export function BecomeOperatorPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [f, setF] = useState<OperatorApplication>(empty);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const set = (patch: Partial<OperatorApplication>) => setF((s) => ({ ...s, ...patch }));
  const [localities, setLocalities] = useState<string[]>([]);

  const submit = async () => {
    setBusy(true);
    try {
      const result = await onboardingApi.apply(f);
      setApplicationId(result.applicationId);
      setDone(true);
      toast.success('Application submitted');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not submit application');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-success" />
        <h1 className="mt-4 font-display text-3xl tracking-tight text-text">Application received</h1>
        <p className="mt-2 text-text-muted">Our team will review your details and email you once your operator account is approved.</p>
        {applicationId && (
          <div className="mt-8">
            <h2 className="mb-3 font-display text-lg text-text">Speed up your review</h2>
            <KycVerificationSection
              operatorApplicationId={applicationId}
              panNumber={f.panNumber ?? ''}
              bankAccountNumber={f.bankAccountNumber ?? ''}
              bankIfsc={f.bankIfsc ?? ''}
              applicantName={`${f.firstName} ${f.lastName}`.trim()}
            />
          </div>
        )}
        <Button className="mt-6" onClick={() => navigate('/')}>Back to home</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="h-6 w-6" /></div>
        <div>
          <h1 className="font-display text-3xl tracking-tight text-text">Become an operator</h1>
          <p className="text-sm text-text-muted">List your buses on Ticketly and start selling tickets</p>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <Card><CardHeader title="Personal details" />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="First name" value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} />
            <Input label="Last name" value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} />
            <Input label="Email" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
            <Input label="Mobile" value={f.mobile} onChange={(e) => set({ mobile: e.target.value })} />
            <Input label="Designation" value={f.designation} onChange={(e) => set({ designation: e.target.value })} />
            <Input label="Password" type="password" value={f.password} onChange={(e) => set({ password: e.target.value })} hint="Used for your operator login" />
          </CardBody>
        </Card>

        <Card><CardHeader title="Company details" />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Company name" value={f.companyName} onChange={(e) => set({ companyName: e.target.value })} />
            <Input label="Company type" value={f.companyType} onChange={(e) => set({ companyType: e.target.value })} placeholder="Private Limited" />
            <Input label="GST number" value={f.gstNumber} onChange={(e) => set({ gstNumber: e.target.value })} />
            <Input label="PAN number" value={f.panNumber} onChange={(e) => set({ panNumber: e.target.value })} />
            <Input label="Registration number" value={f.registrationNumber} onChange={(e) => set({ registrationNumber: e.target.value })} />
            <Input label="Official email" type="email" value={f.officialEmail} onChange={(e) => set({ officialEmail: e.target.value })} />
            <Input label="Company mobile" value={f.companyMobile} onChange={(e) => set({ companyMobile: e.target.value })} />
            <Input label="Website" value={f.website} onChange={(e) => set({ website: e.target.value })} />
          </CardBody>
        </Card>

        <Card><CardHeader title="Address" />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* The PIN first: it fills the city and state. */}
            <PincodeInput
              value={f.pinCode ?? ''}
              onChange={(v) => set({ pinCode: v })}
              onResolved={(p) => { set({ city: p.city, state: p.state, country: 'India' }); setLocalities(p.localities); }}
            />
            <Input label="Address line 1" value={f.addressLine1} onChange={(e) => set({ addressLine1: e.target.value })} placeholder="Building, street" />
            <Input label="Area / locality" list="apply-localities" value={f.addressLine2} onChange={(e) => set({ addressLine2: e.target.value })} />
            <datalist id="apply-localities">{localities.map((l) => <option key={l} value={l} />)}</datalist>
            <Input label="City" value={f.city} onChange={(e) => set({ city: e.target.value })} />
            <Input label="State" value={f.state} onChange={(e) => set({ state: e.target.value })} />
            <Input label="Country" value={f.country} onChange={(e) => set({ country: e.target.value })} />
          </CardBody>
        </Card>

        <Card><CardHeader title="Business details" />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Number of buses" type="number" onChange={(e) => set({ business: { ...f.business, numberOfBuses: Number(e.target.value) || undefined } })} />
            <Input label="Years in business" type="number" onChange={(e) => set({ business: { ...f.business, yearsInBusiness: Number(e.target.value) || undefined } })} />
            <Input label="Estimated daily trips" type="number" onChange={(e) => set({ business: { ...f.business, dailyTrips: Number(e.target.value) || undefined } })} />
            <Input label="Bus types (comma-sep)" onChange={(e) => set({ business: { ...f.business, busTypes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} />
            <Input label="Operational cities (comma-sep)" onChange={(e) => set({ business: { ...f.business, cities: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} />
          </CardBody>
        </Card>

        <Card><CardHeader title="Payout bank account" subtitle="Where your earnings will be paid out once you're approved — double-check this carefully" />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Account holder name" value={f.bankAccountHolder} onChange={(e) => set({ bankAccountHolder: e.target.value })} placeholder="As per bank records" />
            <Input label="Account number" value={f.bankAccountNumber} onChange={(e) => set({ bankAccountNumber: e.target.value.replace(/\D/g, '') })} />
            <IfscInput value={f.bankIfsc ?? ''} onChange={(v) => set({ bankIfsc: v })} onResolved={(b) => set({ bankName: b.bank })} />
            <Input label="Bank name" value={f.bankName} onChange={(e) => set({ bankName: e.target.value })} hint="Filled from the IFSC" />
          </CardBody>
        </Card>

        <div className="flex justify-end">
          <Button size="lg" onClick={submit} loading={busy} disabled={!f.firstName || !f.email || !f.mobile || !f.password || !f.companyName}>
            Submit application
          </Button>
        </div>
      </div>
    </div>
  );
}
