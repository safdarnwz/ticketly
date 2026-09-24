import { Param, ParseUUIDPipe } from '@nestjs/common';

/**
 * A route parameter that must be a UUID (every entity id in this system is
 * one). Rejected with 400 at the edge instead of reaching the database.
 *
 *   async get(@UuidParam('id') id: string) { … }
 */
export const UuidParam = (name: string): ParameterDecorator => Param(name, new ParseUUIDPipe());
