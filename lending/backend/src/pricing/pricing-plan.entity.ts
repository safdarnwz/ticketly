import { Column, Entity, Index } from 'typeorm';
import { paiseTransformer } from '../common/money';
import { Uuid7Entity } from '../common/uuid7.entity';
import type { FeeType, InterestUnit } from './pricing.calc';

export type PlanScope = 'ALL' | 'CUSTOMER';
export type PenalType = 'NONE' | 'PERCENT_PER_DAY' | 'FLAT_PER_DAY';

const num = { to: (v?: number | null) => v, from: (v?: string | null) => (v == null ? null : Number(v)) };

/**
 * A pricing plan / offer. Fully configurable by the OWNER at any time.
 *  - scope ALL      → applies to every customer (default plan, or a time-limited campaign)
 *  - scope CUSTOMER → a personal offer for one mobile number
 * Resolution: valid CUSTOMER plan first, else valid ALL plan; higher priority wins, then newest.
 * Changes apply to NEW offers only. Terms are frozen into each offer/KFS when it is made.
 */
@Entity('pricing_plans')
@Index(['scope', 'active'])
export class PricingPlan extends Uuid7Entity {
  @Column({ length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  scope: PlanScope;

  @Index()
  @Column({ type: 'varchar', length: 10, nullable: true })
  customerMobile: string | null;

  /** Shown to the customer, e.g. "Diwali offer" or "Special rate for you". */
  @Column({ type: 'varchar', length: 120, nullable: true })
  customerLabel: string | null;

  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({ default: true })
  active: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  validFrom: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  validUntil: Date | null;

  /** Max loans that may be made on this plan (null = unlimited). */
  @Column({ type: 'int', nullable: true })
  maxUses: number | null;

  @Column({ type: 'int', default: 0 })
  usedCount: number;

  @Column({ type: 'varchar', length: 10 })
  interestUnit: InterestUnit;

  @Column({ type: 'numeric', precision: 12, scale: 6, transformer: num })
  interestRatePercent: number;

  @Column({ type: 'varchar', length: 10 })
  feeType: FeeType;

  @Column({ type: 'numeric', precision: 14, scale: 4, transformer: num })
  feeValue: number;

  @Column({ type: 'numeric', precision: 6, scale: 3, default: 18, transformer: num })
  gstPercent: number;

  @Column({ type: 'int' })
  tenureDays: number;

  @Column({ type: 'bigint', transformer: paiseTransformer })
  minPrincipalPaise: number;

  @Column({ type: 'bigint', transformer: paiseTransformer })
  maxPrincipalPaise: number;

  @Column({ type: 'varchar', length: 20, default: 'NONE' })
  penalType: PenalType;

  /** Percent per day of the overdue amount, or rupees per day. */
  @Column({ type: 'numeric', precision: 14, scale: 4, default: 0, transformer: num })
  penalValue: number;

  @Column({ type: 'int', default: 3 })
  coolingOffDays: number;

  /** Optional ceiling on APR set by the owner; offers above it are refused. */
  @Column({ type: 'numeric', precision: 10, scale: 3, nullable: true, transformer: num })
  aprCapPercent: number | null;

  @Column('uuid')
  createdBy: string;

  @Column({ type: 'uuid', nullable: true })
  updatedBy: string | null;
}
