import { Column, Entity, Index } from 'typeorm';
import { paiseTransformer } from '../common/money';
import { Uuid7Entity } from '../common/uuid7.entity';
import type { FrozenOffer } from '../pricing/offer';
import { ApplicationStatus } from './journey';

@Entity('loan_applications')
export class LoanApplication extends Uuid7Entity {
  @Index()
  @Column('uuid')
  customerId: string;

  @Index()
  @Column({ type: 'enum', enum: ApplicationStatus, default: ApplicationStatus.STARTED })
  status: ApplicationStatus;

  /** t = 0 of the 5-minute clock: the moment OTP login succeeded. */
  @Column({ type: 'timestamptz' })
  journeyStartedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  bankAccountId: string | null;

  @Column({ type: 'bigint', nullable: true, transformer: paiseTransformer })
  requestedPrincipalPaise: number | null;

  @Column({ type: 'bigint', nullable: true, transformer: paiseTransformer })
  declaredMonthlyIncomePaise: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  employmentType: string | null;

  @Column({ type: 'int', nullable: true })
  bureauScore: number | null;

  @Column({ type: 'text', array: true, default: '{}' })
  decisionReasons: string[];

  @Column({ type: 'uuid', nullable: true })
  pricingPlanId: string | null;

  /** Frozen offer (what the KFS shows). */
  @Column({ type: 'jsonb', nullable: true })
  offer: FrozenOffer | null;

  @Column({ type: 'timestamptz', nullable: true })
  offerExpiresAt: Date | null;

  /** SHA-256 of the exact KFS JSON the borrower saw and accepted. */
  @Column({ type: 'char', length: 64, nullable: true })
  kfsHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  kfsAcceptedAt: Date | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  esignRequestId: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  signedAgreementRef: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  esignedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  clientIp: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  deviceId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  /** Login → money confirmed in the borrower's account. */
  @Column({ type: 'int', nullable: true })
  totalElapsedMs: number | null;

  @Column({ type: 'boolean', nullable: true })
  withinTarget: boolean | null;
}
