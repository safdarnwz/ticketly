import { describe, expect, it } from 'vitest';

import { AggregateRoot } from '../domain/aggregate-root';
import { createEvent } from '../domain/domain-event';
import { Entity } from '../domain/entity';
import { ValueObject } from '../domain/value-object';
import { newId, type Uuid } from '../ids';
import { assertNever } from '../types';

class Thing extends Entity {
  constructor(id: Uuid) {
    super(id);
  }
}

class Money extends ValueObject<{ amount: number; tags: string[] }> {
  constructor(amount: number, tags: string[] = []) {
    super({ amount, tags });
  }
}

class Other extends ValueObject<{ amount: number; tags: string[] }> {
  constructor(amount: number) {
    super({ amount, tags: [] });
  }
}

class Order extends AggregateRoot {
  constructor(id: Uuid) {
    super(id);
  }
  place(): void {
    this.record(
      createEvent({
        type: 'order.placed',
        aggregateType: 'order',
        aggregateId: this.id,
        payload: { n: 1 },
      }),
    );
  }
}

describe('domain building blocks', () => {
  it('entities are equal by id', () => {
    const id = newId();
    const a = new Thing(id);
    expect(a.equals(new Thing(id))).toBe(true);
    expect(a.equals(a)).toBe(true);
    expect(a.equals(new Thing(newId()))).toBe(false);
    expect(a.equals(null)).toBe(false);
  });

  it('value objects are equal by value, frozen and of the same type', () => {
    const m = new Money(5, ['a']);
    expect(m.equals(new Money(5, ['a']))).toBe(true);
    expect(m.equals(new Money(5, ['b']))).toBe(false);
    expect(m.equals(new Money(5))).toBe(false);
    expect(m.equals(m)).toBe(true);
    expect(m.equals(undefined)).toBe(false);
    expect(new Money(5).equals(new Other(5) as never)).toBe(false);
    expect(Object.isFrozen(m.toJSON())).toBe(true);
  });

  it('aggregates collect events until the repository drains them', () => {
    const order = new Order(newId());
    expect(order.version).toBe(0);
    expect(order.hasPendingEvents()).toBe(false);
    order.place();
    expect(order.hasPendingEvents()).toBe(true);
    const events = order.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'order.placed',
      version: 1,
      aggregateId: order.id,
      payload: { n: 1 },
    });
    expect(order.hasPendingEvents()).toBe(false);
  });

  it('assertNever throws on an unexpected value', () => {
    expect(() => assertNever('x' as never)).toThrow('Unexpected value');
  });
});
