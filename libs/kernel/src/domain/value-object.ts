/**
 * A value object has no identity — it *is* its attributes. Immutable by
 * construction, compared structurally. `Money`, `SeatNumber`, `FareBreakup`
 * and `GeoPoint` are value objects.
 *
 * Rule: validate in the factory, never in the getters. Once constructed a value
 * object is guaranteed valid, which removes defensive checks everywhere else.
 */
export abstract class ValueObject<TProps extends object> {
  protected constructor(protected readonly props: Readonly<TProps>) {
    Object.freeze(this.props);
  }

  equals(other?: ValueObject<TProps> | null): boolean {
    if (!other) return false;
    if (this === other) return true;
    if (other.constructor !== this.constructor) return false;
    return structurallyEqual(this.props, other.props);
  }

  toJSON(): Readonly<TProps> {
    return this.props;
  }
}

function structurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    structurallyEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
