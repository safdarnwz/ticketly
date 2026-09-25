import { Body, Controller, Get, Patch, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, UuidParam, zodBody } from '@http';
import { type BranchId } from '@kernel';

import { BranchService } from '../application/branch.service';
import { BranchRepository } from '../infrastructure/persistence/branch.repository';
import {
  CreateBranchSchema,
  type CreateBranchDto,
  UpdateBranchSchema,
  type UpdateBranchDto,
} from './dto/branch.dto';

@ApiTags('branches')
@ApiBearerAuth('bearer')
@Controller({ path: 'branches', version: '1' })
@ApiStandardErrors()
export class BranchController {
  constructor(
    private readonly branches: BranchRepository,
    private readonly service: BranchService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Create a branch/counter location' })
  async create(@Body(zodBody(CreateBranchSchema)) dto: CreateBranchDto) {
    return { id: await this.service.create(dto) };
  }

  @Get()
  @RequirePermission(Permission.TENANT_READ)
  @ApiOperation({ summary: 'List every branch, with current staff headcount' })
  async list() {
    const [items, counts] = await Promise.all([this.branches.list(), this.branches.staffCounts()]);
    return { items: items.map((b) => ({ ...b, staffCount: counts[b.id] ?? 0 })) };
  }

  @Patch(':id')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Update a branch' })
  async update(
    @UuidParam('id') id: string,
    @Body(zodBody(UpdateBranchSchema)) dto: UpdateBranchDto,
  ) {
    await this.service.update(id as BranchId, dto);
    return { ok: true };
  }

  @Post(':id/deactivate')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Deactivate a branch' })
  async deactivate(@UuidParam('id') id: string) {
    await this.service.deactivate(id as BranchId);
    return { ok: true };
  }

  @Post(':id/activate')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Reactivate a branch' })
  async activate(@UuidParam('id') id: string) {
    await this.service.activate(id as BranchId);
    return { ok: true };
  }
}
