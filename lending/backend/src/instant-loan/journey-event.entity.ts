import { Column, Entity, Index } from 'typeorm';
import { Uuid7Entity } from '../common/uuid7.entity';
import { JourneyStep } from './journey';

export enum StepOutcome {
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  REFERRED = 'REFERRED',
}

/** One row per completed step; powers the SLA dashboard and per-step bottleneck analysis. */
@Entity('journey_events')
@Index(['applicationId', 'step'])
export class JourneyEvent extends Uuid7Entity {
  @Column('uuid')
  applicationId: string;

  @Column({ type: 'enum', enum: JourneyStep })
  step: JourneyStep;

  @Column({ type: 'enum', enum: StepOutcome })
  outcome: StepOutcome;

  /** Time taken by this step (including provider calls). */
  @Column({ type: 'int' })
  durationMs: number;

  /** Clock position (ms since t = 0) when the step finished. */
  @Column({ type: 'int' })
  elapsedMs: number;

  @Column({ type: 'int' })
  targetCompleteByMs: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  providerRef: string | null;

  @Column({ type: 'jsonb', default: {} })
  detail: Record<string, unknown>;
}
