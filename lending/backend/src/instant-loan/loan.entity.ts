import { Column, Entity, Index } from 'typeorm';
import { paiseTransformer } from '../common/money';
import { Uuid7Entity } from '../common/uuid7.entity';

export enum LoanStatus {
  PENDING_DISBURSAL = 'PENDING_DISBURSAL',
  ACTIVE = 'ACTIVE',
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
  pricingPolicyId: string;

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
}
