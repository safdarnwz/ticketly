import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';

/**
 * OTP generation and stateless verification.
 *
 * OTPs are the primary login for customers on the B2C app (phone-number based),
 * where passwords are friction. Security properties that matter:
 *  - **Cryptographically random** digits (`randomInt`, not `Math.random`).
 *  - The plaintext OTP is NEVER stored. We store an HMAC of it (see
 *    `hashOtp`), so a database leak does not reveal in-flight codes.
 *  - Verification is constant-time.
 *  - Attempts and expiry are enforced by the caller (auth service) against the
 *    stored record — this service only does the crypto.
 */
@Injectable()
export class OtpService {
  constructor(private readonly config: AppConfig) {}

  /** Generate a numeric OTP of the given length (default 6 digits). */
  generate(length = 6): string {
    let otp = '';
    for (let i = 0; i < length; i += 1) otp += randomInt(0, 10).toString();
    return otp;
  }

  /** Keyed hash of an OTP for at-rest storage. `identity` binds it to the phone. */
  hashOtp(otp: string, identity: string): string {
    return createHmac('sha256', this.config.security.jwtSecret)
      .update(identity)
      .update(':')
      .update(otp)
      .digest('hex');
  }

  verify(otp: string, identity: string, storedHash: string): boolean {
    const computed = this.hashOtp(otp, identity);
    const a = Buffer.from(computed);
    const b = Buffer.from(storedHash);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
