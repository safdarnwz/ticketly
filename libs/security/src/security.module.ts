import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '@config';

import { FieldEncryptor } from './field-encryptor';
import { OtpService } from './otp-service';
import { PasswordHasher } from './password-hasher';
import { TokenService } from './token-service';

/**
 * Cryptographic services, provided globally so any module can inject them
 * without re-wiring. All are stateless and safe to share as singletons.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [PasswordHasher, FieldEncryptor, TokenService, OtpService],
  exports: [PasswordHasher, FieldEncryptor, TokenService, OtpService],
})
export class SecurityModule {}
