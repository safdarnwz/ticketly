import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

export interface AuditEntry {
  actorType: AuditLog['actorType'];
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  async record(e: AuditEntry, manager?: EntityManager) {
    const r = manager ? manager.getRepository(AuditLog) : this.repo;
    await r.save(r.create({ ...e, actorId: e.actorId ?? null, entityId: e.entityId ?? null, data: e.data ?? {} }));
  }

  list(entityType?: string, entityId?: string, limit = 100) {
    return this.repo.find({ where: { ...(entityType && { entityType }), ...(entityId && { entityId }) }, order: { at: 'DESC' }, take: Math.min(limit, 500) });
  }
}
