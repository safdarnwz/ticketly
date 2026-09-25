import { Injectable } from '@nestjs/common';

import { DatabaseService, registerConstraintMessages } from '@database';
import { newId } from '@kernel';

registerConstraintMessages({
  role_templates_code_key: 'A role template with this code already exists',
});

export interface RoleTemplate {
  id: string;
  code: string;
  name: string;
  description: string;
  permissions: string[];
  updatedAt: Date;
}

const COLUMNS = `id, code, name, description, permissions, updated_at AS "updatedAt"`;

/** Platform-wide role → permission bundles (#22). Not tenant data: no RLS. */
@Injectable()
export class RoleTemplateRepository {
  constructor(private readonly db: DatabaseService) {}

  list(): Promise<RoleTemplate[]> {
    return this.db.query<RoleTemplate>(
      `SELECT ${COLUMNS} FROM role_templates WHERE deleted_at IS NULL ORDER BY name`,
      [],
      { name: 'roleTemplates.list' },
    );
  }

  find(id: string): Promise<RoleTemplate | null> {
    return this.db.queryOne<RoleTemplate>(
      `SELECT ${COLUMNS} FROM role_templates WHERE id = $1 AND deleted_at IS NULL`,
      [id],
      { name: 'roleTemplates.find', primary: true },
    );
  }

  async create(
    input: { code: string; name: string; description: string; permissions: string[] },
    actorId: string | null,
  ): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO role_templates (id, code, name, description, permissions, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, input.code, input.name, input.description, input.permissions, actorId],
      { name: 'roleTemplates.create', primary: true },
    );
    return id;
  }

  async update(
    id: string,
    input: { name: string; description: string; permissions: string[] },
  ): Promise<boolean> {
    const n = await this.db.execute_(
      `UPDATE role_templates SET name = $2, description = $3, permissions = $4
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, input.name, input.description, input.permissions],
      { name: 'roleTemplates.update', primary: true },
    );
    return n > 0;
  }

  /** Soft delete; frees the code for reuse. Roles already created from it are untouched. */
  async remove(id: string): Promise<boolean> {
    const n = await this.db.execute_(
      `UPDATE role_templates SET deleted_at = now(), code = code || '#' || id WHERE id = $1 AND deleted_at IS NULL`,
      [id],
      { name: 'roleTemplates.remove', primary: true },
    );
    return n > 0;
  }
}
