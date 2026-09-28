import { Body, Controller, Get, Patch, Post, Query, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  RequirePermission,
  RequirePlatformAdmin,
  UuidParam,
  zodBody,
  zodQuery,
} from '@http';

import { StateNormService } from '../application/services/state-norm.service';
import {
  CreateStateNormSchema,
  ListStateNormsQuerySchema,
  NormsForCitiesQuerySchema,
  UpdateStateNormSchema,
  type CreateStateNormDto,
  type ListStateNormsQueryDto,
  type NormsForCitiesQueryDto,
  type UpdateStateNormDto,
} from './dto/state-norms.dto';

/** The platform sets each state's government rules (liquor, smoking…). */
@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/state-norms', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class StateNormsAdminController {
  constructor(private readonly norms: StateNormService) {}

  @Get('states')
  @ApiOperation({ summary: 'Every state, to pick one for a rule' })
  async states() {
    return { items: await this.norms.states() };
  }

  @Get()
  @ApiOperation({ summary: 'State rules, optionally of one state; switched-off ones on request' })
  async list(@Query(zodQuery(ListStateNormsQuerySchema)) q: ListStateNormsQueryDto) {
    return { items: await this.norms.list(q) };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Add a rule to a state — every route through that state carries it at once',
  })
  create(@Body(zodBody(CreateStateNormSchema)) dto: CreateStateNormDto) {
    return this.norms.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Reword a rule, or switch it off / on (rules are never deleted)' })
  update(
    @UuidParam('id') id: string,
    @Body(zodBody(UpdateStateNormSchema)) dto: UpdateStateNormDto,
  ) {
    return this.norms.update(id, dto);
  }
}

/** Operators see — and cannot drop — the rules of the states their routes pass through. */
@ApiTags('master-data')
@ApiBearerAuth('bearer')
@Controller({ path: 'master-data', version: '1' })
@ApiStandardErrors()
export class StateNormsController {
  constructor(private readonly norms: StateNormService) {}

  @Get('routes/:id/state-norms')
  @RequirePermission(Permission.ROUTE_READ)
  @ApiOperation({ summary: 'Government rules of every state this route passes through' })
  async forRoute(@UuidParam('id') id: string) {
    return { states: await this.norms.forRoute(id) };
  }

  @Get('state-norms')
  @RequirePermission(Permission.ROUTE_READ)
  @ApiOperation({
    summary: 'Government rules for the states of these cities — shown while a route is drawn',
  })
  async forCities(@Query(zodQuery(NormsForCitiesQuerySchema)) q: NormsForCitiesQueryDto) {
    return { states: await this.norms.forCities(q.cityIds) };
  }
}
