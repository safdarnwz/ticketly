/**
 * ============================================================================
 *  OTP delivery provider abstraction
 * ============================================================================
 *
 * A one-time code needs to reach the user over SOME channel. Today that's email;
 * SMS is a planned addition. Coding the flow against this abstraction (not
 * against "send an email") means adding SMS later is one new adapter + a binding
 * change, with zero edits to the auth flow.
 *
 *   OtpProvider
 *   ├── EmailOtpProvider   (live — Gmail)
 *   └── SmsOtpProvider     (stub — future)
 *
 * It is an ABSTRACT CLASS (not an interface) so it can serve as its own Nest DI
 * token and be injected by type — `private readonly otp: OtpProvider` — with no
 * `@Inject(Symbol)` parameter decorator (which the esbuild/tsx transpiler used
 * in dev does not always emit correct metadata for).
 */
export interface OtpDeliveryContext {
  name?: string;
  purpose?: 'login' | 'register' | string;
  brandName?: string;
}

export abstract class OtpProvider {
  abstract readonly channel: 'email' | 'sms';
  /** `to` is an email address or an E.164 phone, per the channel. */
  abstract deliver(to: string, code: string, ctx?: OtpDeliveryContext): Promise<void>;
}
