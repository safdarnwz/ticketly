import { Column, Entity, Index } from 'typeorm';
import { paiseTransformer } from '../common/money';
import { Uuid7Entity } from '../common/uuid7.entity';

export enum PolicyStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  RETIRED = 'RETIRED',
}

/**
 * Board-approved pricing. Drafted by the Credit Risk Manager, activated by the Compliance
 * Officer (a different person). Exactly one policy is ACTIVE at a time. Rates are in basis
 * points (1% = 100 bps). Offers are frozen from the policy at offer time.
 */
@Entity('pricing_policies')
@Index('one_active_policy', ['status'], { unique: true, where: `"status" = 'ACTIVE'` })
export class PricingPolicy extends Uuid7Entity {
  @Column({ length: 120 })
  name: string;

  @Column({ type: 'int' })
  annualInterestBps: number;

  @Column({ type: 'int' })
  processingFeeBps: number;

  /** GST on the processing fee (18% today). Included in the KFS and APR. */
  @Column({ type: 'int', default: 1800 })
  gstOnFeeBps: number;

  @Column({ type: 'int' })
  tenureDays: number;

  @Column({ type: 'bigint', transformer: paiseTransformer })
  minPrincipalPaise: number;

  @Column({ type: 'bigint', transformer: paiseTransformer })
  maxPrincipalPaise: number;

  /** Ceiling on APR set by the board. No offer above this APR can be created. */
  @Column({ type: 'int' })
  aprCapBps: number;

  /** Days in which the borrower can exit by repaying principal + proportionate APR only. */
  @Column({ type: 'int', default: 3 })
  coolingOffDays: number;

  @Column({ type: 'text' })
  penalChargesText: string;

  @Column({ type: 'enum', enum: PolicyStatus, default: PolicyStatus.DRAFT })
  status: PolicyStatus;

  @Column('uuid')
  createdBy: string;

  @Column({ type: 'uuid', nullable: true })
  activatedBy: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  boardApprovalRef: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  activatedAt: Date | null;
}
