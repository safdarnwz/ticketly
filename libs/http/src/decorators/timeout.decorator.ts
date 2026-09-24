import { SetMetadata } from '@nestjs/common';

export const REQUEST_TIMEOUT_KEY = 'request:timeout';

/** Override the global request time budget for one handler (ms). */
export const RequestTimeout = (ms: number): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUEST_TIMEOUT_KEY, ms);
