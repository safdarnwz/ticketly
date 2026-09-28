import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

import { Button, Card, CardBody, CardHeader, Input, useToast } from '@/components/ui';
import { kycApi } from '@/lib/api/kyc';
import { ApiError } from '@/lib/api/client';

type Status = 'idle' | 'checking' | 'verified' | 'failed';

function StatusBadge({ status }: { status: Status }) {
  if (status === 'checking') return <Loader2 className="h-5 w-5 animate-spin text-text-muted" />;
  if (status === 'verified') return <CheckCircle2 className="h-5 w-5 text-success" />;
  if (status === 'failed') return <XCircle className="h-5 w-5 text-danger" />;
  return null;
}

export function KycVerificationSection({
  operatorApplicationId, panNumber, bankAccountNumber, bankIfsc, applicantName,
}: {
  operatorApplicationId: string; panNumber: string; bankAccountNumber: string; bankIfsc: string; applicantName: string;
}) {
  const toast = useToast();

  // PAN
  const [panStatus, setPanStatus] = useState<Status>('idle');
  const [panMessage, setPanMessage] = useState('');

  // Aadhaar (two-step OTP flow)
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [aadhaarStep, setAadhaarStep] = useState<'enter' | 'otp'>('enter');
  const [aadhaarVerificationId, setAadhaarVerificationId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [aadhaarStatus, setAadhaarStatus] = useState<Status>('idle');
  const [aadhaarMessage, setAadhaarMessage] = useState('');

  // Bank account
  const [bankStatus, setBankStatus] = useState<Status>('idle');
  const [bankMessage, setBankMessage] = useState('');

  const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

  const runPanCheck = async () => {
    setPanStatus('checking');
    try {
      // Free format-check first — no point paying Digio for a structurally
      // invalid PAN.
      const format = await kycApi.checkPanFormat(operatorApplicationId, panNumber);
      if (!format.wellFormed) {
        setPanStatus('failed'); setPanMessage(format.reason ?? 'Invalid PAN format'); return;
      }
      const result = await kycApi.verifyPan(operatorApplicationId, panNumber, applicantName);
      if (result.matched) {
        setPanStatus('verified'); setPanMessage(result.nameAtPan ? `Matches: ${result.nameAtPan}` : 'PAN verified');
      } else {
        setPanStatus('failed'); setPanMessage(result.reason ?? 'PAN could not be verified');
      }
    } catch (e) {
      setPanStatus('failed'); setPanMessage(errMsg(e, 'PAN verification failed'));
      toast.error(errMsg(e, 'PAN verification failed'));
    }
  };

  const startAadhaar = async () => {
    setAadhaarStatus('checking');
    try {
      const { verificationId } = await kycApi.startAadhaar(operatorApplicationId, aadhaarNumber);
      setAadhaarVerificationId(verificationId);
      setAadhaarStep('otp');
      setAadhaarStatus('idle');
      toast.success('OTP sent to your Aadhaar-linked mobile');
    } catch (e) {
      setAadhaarStatus('failed'); setAadhaarMessage(errMsg(e, 'Could not send Aadhaar OTP'));
      toast.error(errMsg(e, 'Could not send Aadhaar OTP'));
    }
  };

  const submitAadhaarOtp = async () => {
    if (!aadhaarVerificationId) return;
    setAadhaarStatus('checking');
    try {
      const result = await kycApi.submitAadhaarOtp(aadhaarVerificationId, otp);
      if (result.verified) {
        setAadhaarStatus('verified'); setAadhaarMessage(result.name ? `Verified: ${result.name} (${result.maskedAadhaar})` : 'Aadhaar verified');
      } else {
        setAadhaarStatus('failed'); setAadhaarMessage(result.reason ?? 'OTP did not verify');
      }
    } catch (e) {
      setAadhaarStatus('failed'); setAadhaarMessage(errMsg(e, 'Aadhaar verification failed'));
      toast.error(errMsg(e, 'Aadhaar verification failed'));
    }
  };

  const runBankCheck = async () => {
    setBankStatus('checking');
    try {
      const result = await kycApi.verifyBankAccount(operatorApplicationId, bankAccountNumber, bankIfsc);
      if (result.verified) {
        setBankStatus('verified'); setBankMessage(result.nameAtBank ? `Account holder: ${result.nameAtBank}` : 'Bank account verified');
      } else {
        setBankStatus('failed'); setBankMessage(result.reason ?? 'Bank account could not be verified');
      }
    } catch (e) {
      setBankStatus('failed'); setBankMessage(errMsg(e, 'Bank verification failed'));
      toast.error(errMsg(e, 'Bank verification failed'));
    }
  };

  return (
    <div className="flex flex-col gap-4 text-left">
      <p className="text-sm text-text-muted">
        Optional but recommended — verifying now speeds up your review. Verification is powered by Digio; a small delay is normal.
      </p>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2">PAN <StatusBadge status={panStatus} /></span>} />
        <CardBody className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">{panNumber || 'No PAN entered'}</p>
          {panMessage && <p className={`text-xs ${panStatus === 'verified' ? 'text-success' : 'text-danger'}`}>{panMessage}</p>}
          <Button variant="outline" onClick={runPanCheck} loading={panStatus === 'checking'} disabled={!panNumber || panStatus === 'verified'}>
            {panStatus === 'verified' ? 'Verified' : 'Verify PAN'}
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2">Aadhaar <StatusBadge status={aadhaarStatus} /></span>} />
        <CardBody className="flex flex-col gap-3">
          {aadhaarStep === 'enter' ? (
            <>
              <Input label="Aadhaar number" value={aadhaarNumber} onChange={(e) => setAadhaarNumber(e.target.value)} placeholder="12-digit Aadhaar number" maxLength={12} />
              <Button variant="outline" onClick={startAadhaar} loading={aadhaarStatus === 'checking'} disabled={aadhaarNumber.replace(/\D/g, '').length !== 12}>
                Send OTP
              </Button>
            </>
          ) : (
            <>
              <Input label="Enter OTP" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="OTP sent to your Aadhaar-linked mobile" maxLength={8} />
              {aadhaarMessage && <p className={`text-xs ${aadhaarStatus === 'verified' ? 'text-success' : 'text-danger'}`}>{aadhaarMessage}</p>}
              <Button variant="outline" onClick={submitAadhaarOtp} loading={aadhaarStatus === 'checking'} disabled={!otp || aadhaarStatus === 'verified'}>
                {aadhaarStatus === 'verified' ? 'Verified' : 'Submit OTP'}
              </Button>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2">Bank account <StatusBadge status={bankStatus} /></span>} />
        <CardBody className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">{bankAccountNumber ? `${'X'.repeat(Math.max(0, bankAccountNumber.length - 4))}${bankAccountNumber.slice(-4)} — ${bankIfsc}` : 'No bank account entered'}</p>
          {bankMessage && <p className={`text-xs ${bankStatus === 'verified' ? 'text-success' : 'text-danger'}`}>{bankMessage}</p>}
          <Button variant="outline" onClick={runBankCheck} loading={bankStatus === 'checking'} disabled={!bankAccountNumber || !bankIfsc || bankStatus === 'verified'}>
            {bankStatus === 'verified' ? 'Verified' : 'Verify bank account'}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
