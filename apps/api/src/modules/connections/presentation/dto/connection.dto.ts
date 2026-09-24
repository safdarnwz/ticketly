import { z } from 'zod';

import { TestInstrumentSchema } from '../../../payment/presentation/dto/payment.dto';

/** Pay for both legs (each its own operator's charge) with a sandbox instrument each. */
export const ConfirmConnectionSchema = z.object({
  leg1Instrument: TestInstrumentSchema,
  leg2Instrument: TestInstrumentSchema,
});
export type ConfirmConnectionDto = z.infer<typeof ConfirmConnectionSchema>;
