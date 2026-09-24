/**
 * ============================================================================
 *  OTP delivery provider abstraction
 * ============================================================================
 *
 * A one-time code reaches the user by email or SMS. The auth flow codes
 * against this abstraction; the bound implementation, OtpDeliveryRouter, picks
 * the channel from the identity (an email address, else a mobile number).
 *
 *   OtpProvider
 *   ├── OtpDeliveryRouter  (the binding — routes to one of:)
 *   ├── EmailOtpProvider   (Mailer: SMTP / Gmail, themed template)
 *   └── SmsOtpProvider     (notification SMS provider: MSG91, or log when unconfigured)
 *
 * It is an ABSTRACT CLASS (not an interface) so it can serve as its own Nest DI
 * token and be injected by type — `private readonly otp: OtpProvider` — with no
 * `@Inject(Symbol)` parameter decorator (which the esbuild/tsx transpiler used
 * in dev does not always emit correct metadata for).
 */
export interface OtpDeliveryContext {
  name?: string;
  /** 'login' | 'register' | 'password_reset' | … */
  purpose?: string;
  brandName?: string;
}

export abstract class OtpProvider {
  /** `to` is an email address or a mobile number. */
  abstract deliver(to: string, code: string, ctx?: OtpDeliveryContext): Promise<void>;
}
