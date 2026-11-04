import { Column, Entity, Index } from 'typeorm';
import { Uuid7Entity } from '../common/uuid7.entity';

/** Generated documents (loan agreement + KFS PDF) kept as evidence. */
@Entity('loan_documents')
@Index(['applicationId', 'kind'])
export class LoanDocument extends Uuid7Entity {
  @Column('uuid')
  applicationId: string;

  @Column({ length: 40 })
  kind: 'AGREEMENT_FOR_ESIGN';

  @Column({ type: 'char', length: 64 })
  sha256: string;

  @Column({ type: 'bytea' })
  content: Buffer;
}
