import { EkycProvider, EkycResult, EkycSession, EkycState, EsignInitResult, EsignProvider, EsignStatus } from '../ports';
import { DigioClient, DigioError } from './digio.client';

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Digio DigiKYC with a DigiStudio workflow template (e.g. DigiLocker Aadhaar + PAN). */
export class DigioEkyc implements EkycProvider {
  constructor(private readonly client: DigioClient, private readonly templateName: string) {}

  async start(input: { mobile: string; referenceId: string }): Promise<EkycSession> {
    const r = await this.client.call<{ id?: string; status?: string; access_token?: { id?: string } }>('POST', '/client/kyc/v2/request/with_template', {
      customer_identifier: input.mobile,
      template_name: this.templateName,
      notify_customer: false,
      generate_access_token: true,
      reference_id: input.referenceId.replace(/-/g, '_'),
      transaction_id: input.referenceId.replace(/-/g, '_'),
      expire_in_days: 1,
    });
    if (!r.id || !ID_RE.test(r.id)) throw new DigioError('Digio returned no KYC request id');
    return { requestId: r.id, accessTokenId: r.access_token?.id ?? null, customerIdentifier: input.mobile };
  }

  async result(requestId: string): Promise<EkycResult> {
    if (!ID_RE.test(requestId)) throw new DigioError('Invalid Digio request id');
    const r = await this.client.call<Record<string, unknown>>('POST', `/client/kyc/v2/${requestId}/response?detail_response=true`);
    if (r.id !== requestId) throw new DigioError('Digio status response does not match the request');
    return { ...extractIdentity(r), state: mapKycStatus(String(r.status ?? '')), ref: requestId };
  }
}

export function mapKycStatus(s: string): EkycState {
  const v = s.toLowerCase();
  if (v === 'approved') return 'APPROVED';
  if (v === 'rejected' || v === 'failed') return 'REJECTED';
  if (v === 'expired') return 'EXPIRED';
  return 'PENDING'; // requested, approval_pending, …
}

/**
 * Pulls name, DOB, PAN and Aadhaar last 4 out of a DigiKYC detail response.
 * The exact layout depends on the DigiStudio template, so this walks the whole response and
 * picks fields by name and format. It fails closed: anything not found is null, and the loan
 * journey refuses KYC without a PAN, a name and a DOB. Verify against your Digio sandbox output.
 */
export function extractIdentity(resp: unknown): Omit<EkycResult, 'state' | 'ref'> {
  const out: Omit<EkycResult, 'state' | 'ref'> = { name: null, dob: null, pan: null, nameOnPan: null, aadhaarLast4: null };
  const visit = (node: unknown, path: string[]) => {
    if (Array.isArray(node)) return node.forEach((n) => visit(n, path));
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : null);
    const idNum = (str('id_number') ?? str('pan_number') ?? str('pan') ?? str('document_number') ?? '').toUpperCase().replace(/\s/g, '');
    const where = path.join('.').toLowerCase();
    const name = str('name') ?? str('full_name');
    const dob = normaliseDate(str('dob') ?? str('date_of_birth'));
    if (PAN_RE.test(idNum)) {
      out.pan ??= idNum;
      if (name) out.nameOnPan ??= name;
      if (dob) out.dob ??= dob;
    } else if (where.includes('aadhaar') || /^[X*\d]{8}\d{4}$/.test(idNum) || str('aadhaar_number')) {
      if (name) out.name ??= name;
      if (dob) out.dob = dob; // Aadhaar DOB wins
      const last4 = (str('aadhaar_number') ?? idNum).replace(/\D/g, '').slice(-4);
      if (last4.length === 4) out.aadhaarLast4 ??= last4;
    }
    for (const [k, v] of Object.entries(o)) visit(v, [...path, k]);
  };
  visit(resp, []);
  out.name ??= out.nameOnPan;
  return out;
}

function normaliseDate(s: string | null): string | null {
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/** Digio Aadhaar eSign on an uploaded PDF. */
export class DigioEsign implements EsignProvider {
  constructor(private readonly client: DigioClient) {}

  async initiate(input: { pdfBase64: string; fileName: string; signerName: string; mobile: string }): Promise<EsignInitResult> {
    const r = await this.client.call<{ id?: string; access_token?: { id?: string } }>('POST', '/v2/client/document/uploadpdf', {
      signers: [{ identifier: input.mobile, name: input.signerName, sign_type: 'aadhaar', reason: 'Loan agreement and Key Fact Statement' }],
      expire_in_days: 1,
      display_on_page: 'all',
      notify_signers: false,
      send_sign_link: false,
      generate_access_token: true,
      file_name: input.fileName,
      file_data: input.pdfBase64,
    });
    if (!r.id || !ID_RE.test(r.id)) throw new DigioError('Digio returned no document id');
    return { requestId: r.id, accessTokenId: r.access_token?.id ?? null };
  }

  async status(requestId: string): Promise<EsignStatus> {
    if (!ID_RE.test(requestId)) throw new DigioError('Invalid Digio document id');
    const r = await this.client.call<{ agreement_status?: string; signing_parties?: { name?: string; status?: string }[] }>('GET', `/v2/client/document/${requestId}`);
    const st = (r.agreement_status ?? '').toLowerCase();
    const party = r.signing_parties?.[0];
    return {
      signed: st === 'completed' || party?.status?.toLowerCase() === 'signed',
      failed: st === 'expired' || st === 'failed' || st === 'cancelled',
      signerName: party?.name ?? null,
    };
  }
}
