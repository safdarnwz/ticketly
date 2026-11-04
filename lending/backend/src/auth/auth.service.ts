import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { hmacHash, safeEqualHex } from '../common/crypto';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { Customer } from '../customers/customer.entity';
import { CustomerPrincipal } from './auth.types';
import { OtpChallenge } from './otp-challenge.entity';

const OTP_TTL_MS = 5 * 60_000;
const MAX_OTP_PER_10_MIN = 3;
const MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(OtpChallenge) private readonly otps: Repository<OtpChallenge>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async requestOtp(mobile: string) {
    const recent = await this.otps.count({ where: { mobile, createdAt: MoreThan(new Date(Date.now() - 10 * 60_000)) } });
    if (recent >= MAX_OTP_PER_10_MIN) throw new HttpException('Too many OTP requests. Try again in a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const c = await this.otps.save(
      this.otps.create({ mobile, codeHash: hmacHash(`${mobile}:${code}`, this.cfg.piiHashPepper), expiresAt: new Date(Date.now() + OTP_TTL_MS) }),
    );
    // Live mode: hand `code` to the SMS gateway (DLT-registered template). Never log it.
    return { challengeId: c.id, expiresInSec: OTP_TTL_MS / 1000, ...(this.cfg.integrationsMode === 'sandbox' && { sandboxOtp: code }) };
  }

  async verifyOtp(challengeId: string, mobile: string, code: string) {
    const c = await this.otps.findOne({ where: { id: challengeId, mobile, consumedAt: IsNull() } });
    if (!c || c.expiresAt < new Date()) throw new UnauthorizedException('OTP expired. Request a new one.');
    if (c.attempts >= MAX_ATTEMPTS) throw new UnauthorizedException('Too many wrong attempts. Request a new OTP.');
    const ok = safeEqualHex(c.codeHash, hmacHash(`${mobile}:${code}`, this.cfg.piiHashPepper));
    if (!ok) {
      await this.otps.increment({ id: c.id }, 'attempts', 1);
      throw new UnauthorizedException('Wrong OTP');
    }
    const loginAt = Date.now();
    await this.otps.update({ id: c.id }, { consumedAt: new Date(loginAt) });
    let customer = await this.customers.findOne({ where: { mobile } });
    if (!customer) customer = await this.customers.save(this.customers.create({ mobile }));
    await this.audit.record({ actorType: 'CUSTOMER', actorId: customer.id, action: 'auth.otp_login', entityType: 'customer', entityId: customer.id });
    const principal: CustomerPrincipal = { typ: 'customer', sub: customer.id, mobile, loginAt, otpMs: loginAt - c.createdAt.getTime() };
    return { accessToken: await this.jwt.signAsync(principal, { expiresIn: '30m' }), customerId: customer.id };
  }

  static assertMobile(mobile: string) {
    if (!/^[6-9]\d{9}$/.test(mobile)) throw new BadRequestException('Enter a valid 10-digit Indian mobile number');
  }
}
