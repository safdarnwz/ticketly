import { Column, Entity, Index } from 'typeorm';
import { paiseTransformer } from '../common/money';
import { Uuid7Entity } from '../common/uuid7.entity';

export enum RepaymentStatus {
  CREATED = 'CREATED',
  PAID = 'PAID',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

/**
 * One payment attempt by the borrower (UPI / net banking / debit card through the gateway).
 * There is no auto-debit: every repayment is started by the customer.
 */
@Entity('repayments')
export class Repayment extends Uuid7Entity {
  @Index()
  @Column('uuid')
  loanId: string;

  @Column('uuid')
  customerId: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  orderId: string | null;

  @Column({ type: 'bigint', transformer: paiseTransformer })
  amountPaise: number;

  @Column({ type: 'bigint', default: 0, transformer: paiseTransformer })
  paidPaise: number;

  @Index()
  @Column({ type: 'enum', enum: RepaymentStatus, default: RepaymentStatus.CREATED })
  status: RepaymentStatus;

  @Column({ type: 'text', nullable: true })
  paymentUrl: string | null;

  @Column({ type: 'text', nullable: true })
  upiIntentUrl: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  method: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  utr: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Human-readable receipt number, set when paid. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  receiptNo: string | null;
}
