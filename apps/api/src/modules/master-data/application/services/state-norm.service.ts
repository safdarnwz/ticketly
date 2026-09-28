import { Injectable } from '@nestjs/common';

import { getUserId, NotFoundError } from '@kernel';

import { groupByState, type StateNormCategory, type StateRules } from '../../domain/state-norms';
import { StateNormRepository } from '../../infrastructure/persistence/state-norm.repository';

@Injectable()
export class StateNormService {
  constructor(private readonly norms: StateNormRepository) {}

  states() {
    return this.norms.states();
  }

  list(filter: { stateId?: string; includeInactive?: boolean }) {
    return this.norms.list(filter);
  }

  async create(input: {
    stateId: string;
    category: StateNormCategory;
    title: string;
    body: string;
  }) {
    if (!(await this.norms.stateExists(input.stateId)))
      throw new NotFoundError('State', input.stateId);
    const id = await this.norms.create({ ...input, by: getUserId() ?? null });
    return this.norms.get(id);
  }

  async update(
    id: string,
    patch: { category?: StateNormCategory; title?: string; body?: string; isActive?: boolean },
  ) {
    if (!(await this.norms.update(id, { ...patch, by: getUserId() ?? null })))
      throw new NotFoundError('State rule', id);
    return this.norms.get(id);
  }

  /** Every state the route passes through, each with its rules — none of which the operator can drop. */
  async forRoute(routeId: string): Promise<StateRules[]> {
    if (!(await this.norms.routeExists(routeId))) throw new NotFoundError('Route', routeId);
    return this.group(await this.norms.statesOfRoute(routeId));
  }

  /** The same for a route still being drawn: the states of its cities. */
  async forCities(cityIds: string[]): Promise<StateRules[]> {
    return this.group(await this.norms.statesOfCities(cityIds));
  }

  private async group(states: { id: string; name: string }[]): Promise<StateRules[]> {
    return groupByState(states, await this.norms.forStates(states.map((s) => s.id)));
  }
}
