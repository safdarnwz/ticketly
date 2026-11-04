import { Column, Entity, Index } from 'typeorm';
import { Uuid7Entity } from '../common/uuid7.entity';

/** Every message sent to a borrower. (loanId, kind) is unique so a reminder is never sent twice. */
@Entity('notifications')
@Index(['loanId', 'kind'], { unique: true })
export class Notification extends Uuid7Entity {
  @Column('uuid')
  loanId: string;

  @Column('uuid')
  customerId: string;

  @Column({ length: 40 })
  kind: string;

  @Column({ length: 10, default: 'SMS' })
  channel: string;

  @Column({ length: 60 })
  templateKey: string;

  @Column({ type: 'jsonb', default: {} })
  vars: Record<string, string>;

  @Column({ type: 'varchar', length: 100, nullable: true })
  providerRef: string | null;
}
