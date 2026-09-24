import type { Uuid } from '../ids';

/**
 * An entity has identity: two entities are the same if their ids match, no
 * matter how many fields differ. (Contrast with `ValueObject`.)
 */
export abstract class Entity<TId extends Uuid = Uuid> {
  protected constructor(readonly id: TId) {}

  equals(other?: Entity<TId> | null): boolean {
    if (!other) return false;
    if (this === other) return true;
    return this.id === other.id;
  }
}
