import { Column, Entity, Index } from 'typeorm';
import { Uuid7Entity } from '../common/uuid7.entity';

@Entity('bank_accounts')
@Index(['customerId', 'accountHash'], { unique: true })
export class BankAccount extends Uuid7Entity {
  @Index()
  @Column('uuid')
  customerId: string;

  /** AES-256-GCM encrypted account number. */
  @Column({ type: 'text' })
  accountNumberEnc: string;

  @Column({ type: 'char', length: 64 })
  accountHash: string;

  @Column({ length: 4 })
  accountLast4: string;

  @Column({ length: 11 })
  ifsc: string;

  /** Name returned by the bank during penny drop / account validation. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  bankHolderName: string | null;

  /** 0..1 similarity between the KYC name and the bank holder name. */
  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true, transformer: { to: (v) => v, from: (v) => (v == null ? v : Number(v)) } })
  nameMatchScore: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  verificationRef: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;
}
