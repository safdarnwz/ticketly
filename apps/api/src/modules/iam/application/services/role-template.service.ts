import { Injectable } from '@nestjs/common';

import { Permission } from '@contracts';
import { AppError, ErrorCode, NotFoundError, type RoleId } from '@kernel';

import { permissionGrantProblems } from '../../domain/permission-grant';
import {
  RoleTemplateRepository,
  type RoleTemplate,
} from '../../infrastructure/persistence/role-template.repository';
import { StaffAccessService } from './staff-access.service';

/**
 * Global role templates (#22): the platform defines permission bundles
 * ("Booking clerk", "Accounts"), an operator turns one into its own role in
 * one step and can then edit that copy freely. Templates hold operator
 * permissions only.
 */
@Injectable()
export class RoleTemplateService {
  constructor(
    private readonly templates: RoleTemplateRepository,
    private readonly access: StaffAccessService,
  ) {}

  list(): Promise<RoleTemplate[]> {
    return this.templates.list();
  }

  async create(
    input: { code: string; name: string; description?: string; permissions: string[] },
    actorId: string | null,
  ): Promise<RoleTemplate> {
    assertOperatorPermissions(input.permissions);
    const id = await this.templates.create(
      { ...input, description: input.description ?? '', permissions: unique(input.permissions) },
      actorId,
    );
    return this.get(id);
  }

  async update(
    id: string,
    input: { name: string; description?: string; permissions: string[] },
  ): Promise<RoleTemplate> {
    assertOperatorPermissions(input.permissions);
    const ok = await this.templates.update(id, {
      ...input,
      description: input.description ?? '',
      permissions: unique(input.permissions),
    });
    if (!ok) throw new NotFoundError('Role template', id);
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    if (!(await this.templates.remove(id))) throw new NotFoundError('Role template', id);
  }

  /** Operator side: create this tenant's own role from a template. */
  async apply(id: string, input: { code?: string; name?: string }): Promise<{ id: RoleId }> {
    const template = await this.get(id);
    return {
      id: await this.access.createRole({
        code: input.code ?? template.code,
        name: input.name ?? template.name,
        description: template.description,
        permissions: template.permissions,
      }),
    };
  }

  private async get(id: string): Promise<RoleTemplate> {
    const t = await this.templates.find(id);
    if (!t) throw new NotFoundError('Role template', id);
    return t;
  }
}

function assertOperatorPermissions(permissions: string[]): void {
  const problems = permissionGrantProblems(permissions, new Set([Permission.ALL]));
  if (problems.length > 0)
    throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
      message: problems.join('; '),
      details: { problems },
    });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
