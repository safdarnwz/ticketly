import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JourneyStep, STEP_TARGETS } from './journey';
import { JourneyEvent, StepOutcome } from './journey-event.entity';
import { LoanApplication } from './loan-application.entity';

@Injectable()
export class JourneyRecorder {
  async record(
    m: EntityManager,
    app: LoanApplication,
    step: JourneyStep,
    outcome: StepOutcome,
    startedAtMs: number,
    extra: { providerRef?: string | null; detail?: Record<string, unknown>; at?: number } = {},
  ) {
    const at = extra.at ?? Date.now();
    const target = STEP_TARGETS.find((t) => t.step === step)!;
    const r = m.getRepository(JourneyEvent);
    await r.save(
      r.create({
        applicationId: app.id,
        step,
        outcome,
        durationMs: Math.max(0, at - startedAtMs),
        elapsedMs: Math.max(0, at - app.journeyStartedAt.getTime()),
        targetCompleteByMs: target.completeBySec * 1000,
        providerRef: extra.providerRef ?? null,
        detail: extra.detail ?? {},
      }),
    );
  }
}
