import { get, post, withIdempotency } from './client';

export type PaymentMethod = 'upi' | 'credit_card' | 'debit_card' | 'net_banking';

export interface TestMethodsResponse {
  testMode: boolean;
  methods: { value: PaymentMethod; label: string }[];
  banks: string[];
  hints: {
    upi: string;
    upiFailure: string;
    card: string;
    cardExpiry: string;
    cardCvv: string;
    netbankingUser: string;
    netbankingPassword: string;
  } | null;
}

export interface ChargeResult {
  status: 'captured';
  pnr: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  instrument: string;
  label: string;
}

export type ChargeInstrument =
  | { method: 'upi'; vpa: string }
  | { method: 'credit_card' | 'debit_card'; cardNumber: string; expiry: string; cvv: string; holder?: string }
  | { method: 'net_banking'; bank: string; username: string; password: string };

/**
 * Sandbox/test payment gateway client. TEMPORARY — mirrors the backend test
 * gateway that is active while PAYMENT_TEST_MODE is on and no real PSP is wired.
 */
export const paymentsApi = {
  /** Available methods + banks + (in test mode) the credentials that succeed. */
  testMethods: () => get<TestMethodsResponse>('/v1/payments/test-methods'),

  /** Staff-assisted sale: the SAME verified sandbox-gateway charge a customer would use, entered by staff on the customer's behalf — no cash-shortcut, no assumed payment. */
  chargeTest: (bookingId: string, vpa: string) =>
    post<{ pnr: string }>('/v1/payments/charge', { bookingId, method: 'upi', vpa }, withIdempotency(`test-charge-${bookingId}`)),

  /** Seat upgrade — creates a REAL gateway order for the fare differential + its own GST; the seat is only swapped once the customer actually completes Razorpay checkout (see openRazorpayCheckout) and the webhook confirms capture. */
  upgradeSeat: (ticketId: string, toSeatNumber: string) =>
    post<{ intentId: string; clientPayload: RazorpayClientPayload; differentialMinor: number }>('/v1/payments/upgrade-seat', { ticketId, toSeatNumber }, withIdempotency(`upgrade-${ticketId}-${toSeatNumber}`)),

  /** Charge a held booking. On success the booking is confirmed + ledger posted.
   * Key includes the instrument so a genuine retry with DIFFERENT payment
   * details (e.g. card declined, customer tries UPI instead) isn't blocked
   * by a cached rejection from the first attempt — only an exact re-click
   * with the SAME details dedupes. */
  /** `attemptKey` identifies one press of Pay (retries of it replay); card details never go in a header. */
  charge: (bookingId: string, instrument: ChargeInstrument, attemptKey: string) =>
    post<ChargeResult>('/v1/payments/charge', { bookingId, ...instrument }, withIdempotency(`charge-${bookingId}-${attemptKey}`)),

  /** REAL payment: create a gateway (Razorpay) order for a held booking. */
  /** Keyed on the amount too: after add-ons change the total, a new gateway order is made instead of replaying the old one. */
  createIntent: (bookingId: string, totalMinor: number) =>
    post<{ intentId: string; clientPayload: RazorpayClientPayload }>('/v1/payments/intent', { bookingId }, withIdempotency(`intent-${bookingId}-${totalMinor}`)),

  /** REAL payment: verify Razorpay's client-side checkout callback and confirm the booking immediately. */
  verify: (bookingId: string, callback: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
    post<{ pnr: string }>('/v1/payments/verify', { bookingId, ...callback },
      // Deterministic (not random) — keyed on Razorpay's own payment id, so a
      // genuine retry of THIS SAME verification (e.g. a network hiccup right
      // after Razorpay's handler fires) reuses the same key and gets the
      // idempotent replay, rather than a fresh random key sailing straight
      // past the interceptor's protection.
      withIdempotency(`verify-${callback.razorpay_payment_id}`)),
};

export interface RazorpayClientPayload {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  prefill?: { contact?: string; email?: string };
}

let razorpayScriptPromise: Promise<void> | null = null;
/** Loads Razorpay's Checkout.js once, however many times this is called. */
function loadRazorpayScript(): Promise<void> {
  if (typeof window !== 'undefined' && (window as unknown as { Razorpay?: unknown }).Razorpay) return Promise.resolve();
  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load Razorpay checkout script'));
      document.body.appendChild(script);
    });
  }
  return razorpayScriptPromise;
}

interface RazorpaySuccessResponse { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }

/**
 * Open Razorpay's Checkout modal. Resolves when the customer completes
 * payment (Razorpay's own client-side handler); rejects on dismiss/failure.
 * The booking is actually confirmed server-side by the webhook
 * (`POST /v1/payments/webhook/razorpay`) — this promise is purely for the UI
 * to know when to move on, not the source of truth.
 */
export async function openRazorpayCheckout(payload: RazorpayClientPayload): Promise<RazorpaySuccessResponse> {
  await loadRazorpayScript();
  return new Promise((resolve, reject) => {
    const Razorpay = (window as unknown as { Razorpay: new (opts: unknown) => { open: () => void } }).Razorpay;
    const rzp = new Razorpay({
      ...payload,
      handler: (response: RazorpaySuccessResponse) => resolve(response),
      modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
      // The checkout window takes the app's primary colour.
      theme: { color: getComputedStyle(document.documentElement).getPropertyValue('--yb-color-primary').trim() || '#3F5475' },
    });
    rzp.open();
  });
}
