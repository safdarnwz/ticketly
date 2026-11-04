import { DigioClient } from './digio.client';
import { DigioEkyc, DigioEsign, extractIdentity, mapKycStatus } from './digio.adapters';

const cfg = { env: 'sandbox' as const, apiBase: 'https://ext.digio.in:444', sdkUrl: '', clientId: 'AI_ID', clientSecret: 'SECRET', kycTemplate: 'T', webhookSecret: 'w' };

function fakeFetch(responses: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(responses.shift()), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('Digio adapters', () => {
  it('creates a KYC request from a template with Basic auth and an SDK token', async () => {
    const { f, calls } = fakeFetch([{ id: 'KID_1', status: 'requested', access_token: { id: 'GWT_1' } }]);
    const s = await new DigioEkyc(new DigioClient(cfg, f), 'DIGILOCKER_AADHAAR_PAN').start({ mobile: '9876543210', referenceId: '01a1-b2' });
    expect(s).toEqual({ requestId: 'KID_1', accessTokenId: 'GWT_1', customerIdentifier: '9876543210' });
    expect(calls[0].url).toBe('https://ext.digio.in:444/client/kyc/v2/request/with_template');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('AI_ID:SECRET').toString('base64')}`);
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({ customer_identifier: '9876543210', template_name: 'DIGILOCKER_AADHAAR_PAN', generate_access_token: true, reference_id: '01a1_b2' });
  });

  it('reads the KYC response and refuses a mismatched id', async () => {
    const { f, calls } = fakeFetch([{ id: 'KID_1', status: 'approved' }, { id: 'KID_X', status: 'approved' }]);
    const k = new DigioEkyc(new DigioClient(cfg, f), 'T');
    expect((await k.result('KID_1')).state).toBe('APPROVED');
    expect(calls[0].url).toBe('https://ext.digio.in:444/client/kyc/v2/KID_1/response?detail_response=true');
    await expect(k.result('KID_1')).rejects.toThrow(/does not match/);
  });

  it('uploads the agreement PDF for Aadhaar eSign and reads completion', async () => {
    const { f, calls } = fakeFetch([{ id: 'DID_1', access_token: { id: 'GWT' } }, { agreement_status: 'completed', signing_parties: [{ name: 'RAHUL', status: 'signed' }] }]);
    const e = new DigioEsign(new DigioClient(cfg, f));
    expect(await e.initiate({ pdfBase64: 'JVBER', fileName: 'loan.pdf', signerName: 'Rahul', mobile: '9876543210' })).toEqual({ requestId: 'DID_1', accessTokenId: 'GWT' });
    const body = JSON.parse(calls[0].init.body as string);
    expect(calls[0].url).toBe('https://ext.digio.in:444/v2/client/document/uploadpdf');
    expect(body.signers[0]).toMatchObject({ identifier: '9876543210', sign_type: 'aadhaar' });
    expect(await e.status('DID_1')).toEqual({ signed: true, failed: false, signerName: 'RAHUL' });
  });

  it('maps statuses conservatively', () => {
    expect(mapKycStatus('approval_pending')).toBe('PENDING');
    expect(mapKycStatus('rejected')).toBe('REJECTED');
  });
});

describe('extractIdentity', () => {
  it('finds Aadhaar and PAN details anywhere in the response (assumed DigiLocker layout)', () => {
    const resp = {
      id: 'KID_1',
      actions: [
        { type: 'digilocker', details: { aadhaar: { name: 'Rahul Kumar Sharma', dob: '10/04/1992', id_number: 'XXXXXXXX1234' }, pan: { name: 'RAHUL KUMAR SHARMA', id_number: 'abcde1234f' } } },
      ],
    };
    expect(extractIdentity(resp)).toEqual({ name: 'Rahul Kumar Sharma', dob: '1992-04-10', pan: 'ABCDE1234F', nameOnPan: 'RAHUL KUMAR SHARMA', aadhaarLast4: '1234' });
  });

  it('fails closed when fields are missing', () => {
    expect(extractIdentity({ id: 'KID', status: 'approved' })).toEqual({ name: null, dob: null, pan: null, nameOnPan: null, aadhaarLast4: null });
  });
});
