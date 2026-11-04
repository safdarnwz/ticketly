import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Permission, permissionsFor } from '../common/roles';
import { Principal } from './auth.types';

const PERMS_KEY = 'required_permissions';
export const RequirePermissions = (...p: Permission[]) => SetMetadata(PERMS_KEY, p);
export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user as Principal);

function bearer(ctx: ExecutionContext): string {
  const h: string | undefined = ctx.switchToHttp().getRequest().headers.authorization;
  if (!h?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
  return h.slice(7);
}

@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  async canActivate(ctx: ExecutionContext) {
    const p = await this.jwt.verifyAsync<Principal>(bearer(ctx)).catch(() => null);
    if (!p || p.typ !== 'customer') throw new UnauthorizedException();
    ctx.switchToHttp().getRequest().user = p;
    return true;
  }
}

@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext) {
    const p = await this.jwt.verifyAsync<Principal>(bearer(ctx)).catch(() => null);
    if (!p || p.typ !== 'staff') throw new UnauthorizedException();
    ctx.switchToHttp().getRequest().user = p;
    const needed = this.reflector.getAllAndOverride<Permission[]>(PERMS_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const have = permissionsFor(p.roles);
    if (!needed.every((n) => have.has(n))) throw new ForbiddenException('Your role does not allow this action');
    return true;
  }
}
