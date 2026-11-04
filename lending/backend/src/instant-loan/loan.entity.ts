import { Column, Entity, Index } from 'typeorm';
import { paiseTransformer } from '../common/money';
import { Uuid7Entity } from '../common/uuid7.entity';

export enum LoanStatus {
  PENDING_DISBURSAL = 'PENDING_DISBURSAL',
  ACTIVE = 'ACTIVE',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
  CLOSED = 'CLOSED',
}

@Entity('loans')
export class Loan extends Uuid7Entity {
  @Index({ unique: true })
  @Column('uuid')
  applicationId: string;

  @Index()
  @Column('uuid')
  customerId: string;

  @Column('uuid')
  pricingPlanId: string;

  @Column({ type: 'bigint', transformer: paiseTransformer })
  principalPaise: number;

  @Column({ type: 'bigint', transformer: paiseTransformer })
  processingFeePaise: number;

  @Column({ type: 'bigint', transformer: paiseTransformer })
  gstOnFeePaise: number;

  @Column({ type: 'bigint', transformer: paiseTransformer })
  netDisbursalPaise: number;

  @Column({ type: 'bigint', transformer: paiseTransformer })
  interestPaise: number;

  @Column({ type: 'bigint', transformer: paiseTransformer })
  totalRepayablePaise: number;

  @Column({ type: 'int' })
  aprBps: number;

  @Column({ type: 'int' })
  tenureDays: number;

  @Column({ type: 'enum', enum: LoanStatus, default: LoanStatus.PENDING_DISBURSAL })
  status: LoanStatus;

  /** Interest runs from the actual credit to the borrower, not from sanction. */
  @Column({ type: 'timestamptz', nullable: true })
  disbursedAt: Date | null;

  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'date', nullable: true })
  coolingOffEndsOn: string | null;

  /** Penal terms frozen from the offer. Penal is tracked separately, never added to interest. */
  @Column({ type: 'varchar', length: 20, default: 'NONE' })
  penalType: 'NONE' | 'PERCENT_PER_DAY' | 'FLAT_PER_DAY';

  @Column({ type: 'numeric', precision: 14, scale: 4, default: 0, transformer: { to: (v) => v, from: (v) => (v == null ? 0 : Number(v)) } })
  penalValue: number;

  @Column({ type: 'bigint', default: 0, transformer: paiseTransformer })
  penalAccruedPaise: number;

  /** Last IST date for which penal has been accrued. */
  @Column({ type: 'date', nullable: true })
  penalAccruedThrough: string | null;

  @Column({ type: 'bigint', default: 0, transformer: paiseTransformer })
  paidPaise: number;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}
