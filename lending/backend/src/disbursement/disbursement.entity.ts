import { Column, Entity, Index } from 'typeorm';
import { paiseTransformer } from '../common/money';
import { Uuid7Entity } from '../common/uuid7.entity';

export enum PayoutRail {
  IMPS = 'IMPS',
  UPI = 'UPI',
  NEFT = 'NEFT',
}

export enum DisbursementStatus {
  INITIATED = 'INITIATED',
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

/**
 * One row per payout attempt. The idempotency key is unique, so retries of the same attempt
 * can never send money twice. A fallback attempt (e.g. IMPS → NEFT) is only created after
 * the provider has confirmed the previous attempt FAILED.
 */
@Entity('disbursements')
export class Disbursement extends Uuid7Entity {
  @Index()
  @Column('uuid')
  loanId: string;

  @Column('uuid')
  bankAccountId: string;

  @Column({ type: 'bigint', transformer: paiseTransformer })
  amountPaise: number;

  @Column({ type: 'enum', enum: PayoutRail })
  rail: PayoutRail;

  @Column({ type: 'int' })
  attempt: number;

  @Index({ unique: true })
  @Column({ length: 80 })
  idempotencyKey: string;

  @Index()
  @Column({ type: 'enum', enum: DisbursementStatus, default: DisbursementStatus.INITIATED })
  status: DisbursementStatus;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  providerRef: string | null;

  /** Bank UTR / RRN, the proof the money reached the beneficiary bank. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  utr: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  failureCode: string | null;

  @Column({ type: 'timestamptz' })
  initiatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  /** Set when the transaction was matched against the bank statement / recon API. */
  @Column({ type: 'timestamptz', nullable: true })
  reconciledAt: Date | null;
}
