/**
 * @kernel — dependency-free domain primitives.
 *
 * Nothing in here may import Nest, pg, fastify, redis or any other
 * infrastructure. That constraint is what makes the domain unit-testable in
 * milliseconds and portable if the transport or database ever changes.
 * The `no-restricted-imports` ESLint rule enforces it.
 */
export * from './types';
export * from './ids';
export * from './error-codes';
export * from './errors';
export * from './result';
export * from './money';
export * from './date-time';
export * from './clock';
export * from './pagination';
export * from './guard';
export * from './request-context';
export * from './retry';
export * from './single-flight';
export * from './domain/domain-event';
export * from './domain/entity';
export * from './domain/value-object';
export * from './domain/aggregate-root';
export * from './concurrency';
export * from './csv';
