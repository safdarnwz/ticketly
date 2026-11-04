import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, BeforeInsert } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

/** Append-only audit trail. No update or delete code path exists for this table. */
@Entity('audit_logs')
@Index(['entityType', 'entityId'])
export class AuditLog {
  @PrimaryColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  at: Date;

  @Column({ length: 20 })
  actorType: 'CUSTOMER' | 'STAFF' | 'SYSTEM' | 'PROVIDER';

  @Column({ type: 'varchar', length: 64, nullable: true })
  actorId: string | null;

  @Column({ length: 80 })
  action: string;

  @Column({ length: 40 })
  entityType: string;

  @Column({ type: 'uuid', nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', default: {} })
  data: Record<string, unknown>;

  @BeforeInsert()
  assignUuid7() {
    if (!this.id) this.id = uuidv7();
  }
}
