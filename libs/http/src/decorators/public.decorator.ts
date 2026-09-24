import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:public';

/**
 * Opt a route out of authentication.
 *
 * The default is **authenticated**: the global auth guard (Part 2) protects
 * everything unless a handler says otherwise. Defaulting the other way — public
 * unless annotated — means one forgotten decorator becomes a data breach, which
 * is a bet no ticketing platform should take.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
