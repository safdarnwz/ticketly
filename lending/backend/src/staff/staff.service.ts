import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { StaffPrincipal } from '../auth/auth.types';
import { hashPassword, newTotpSecret, verifyPassword, verifyTotp } from '../common/crypto';
import { findRoleConflicts, Role, STAFF_ROLES } from '../common/roles';
import { StaffUser } from './staff-user.entity';

@Injectable()
export class StaffService {
  constructor(
    @InjectRepository(StaffUser) private readonly repo: Repository<StaffUser>,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  static validateRoles(roles: Role[]) {
    if (!roles.length) throw new BadRequestException('At least one role is required');
    const bad = roles.filter((r) => !STAFF_ROLES.includes(r));
    if (bad.length) throw new BadRequestException(`Not a staff role: ${bad.join(', ')}`);
    const conflicts = findRoleConflicts(roles);
    if (conflicts.length)
      throw new BadRequestException(`These roles cannot be held by one person (maker-checker): ${conflicts.map((c) => c.join(' + ')).join('; ')}`);
  }

  async create(input: { email: string; name: string; title: string; password: string; roles: Role[] }, actorId: string | null) {
    StaffService.validateRoles(input.roles);
    if (input.password.length < 12) throw new BadRequestException('Password must be at least 12 characters');
    if (await this.repo.exist({ where: { email: input.email.toLowerCase() } })) throw new ConflictException('Email already registered');
    const totpSecret = newTotpSecret();
    const u = await this.repo.save(
      this.repo.create({ email: input.email.toLowerCase(), name: input.name, title: input.title, roles: input.roles, passwordHash: hashPassword(input.password), totpSecret }),
    );
    await this.audit.record({ actorType: actorId ? 'STAFF' : 'SYSTEM', actorId, action: 'staff.created', entityType: 'staff_user', entityId: u.id, data: { roles: u.roles } });
    // The TOTP secret is shown once so the employee can add it to an authenticator app.
    return { id: u.id, email: u.email, roles: u.roles, totpSecret, otpauthUrl: `otpauth://totp/Lending:${encodeURIComponent(u.email)}?secret=${totpSecret}&issuer=Lending` };
  }

  async login(email: string, password: string, totpCode: string) {
    const u = await this.repo.findOne({ where: { email: email.toLowerCase(), active: true } });
    const ok = !!u && verifyPassword(password, u.passwordHash) && verifyTotp(u.totpSecret, totpCode);
    if (!ok) throw new UnauthorizedException('Invalid email, password or authenticator code');
    await this.audit.record({ actorType: 'STAFF', actorId: u.id, action: 'staff.login', entityType: 'staff_user', entityId: u.id });
    const p: StaffPrincipal = { typ: 'staff', sub: u.id, roles: u.roles };
    return { accessToken: await this.jwt.signAsync(p, { expiresIn: '8h' }), roles: u.roles, name: u.name };
  }

  list() {
    return this.repo.find({ select: ['id', 'email', 'name', 'title', 'roles', 'active', 'createdAt'], order: { createdAt: 'ASC' } });
  }
}
