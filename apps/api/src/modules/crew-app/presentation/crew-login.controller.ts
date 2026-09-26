import { Body, Controller, HttpCode, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, UuidParam, zodBody } from '@http';

import { CrewAppService } from '../application/services/crew-app.service';
import { CrewLoginSchema, type CrewLoginDto } from './dto/crew-app.dto';

/** The operator's side of the crew app: give a crew member a login, or reset its password. */
@ApiTags('fleet')
@ApiBearerAuth('bearer')
@Controller({ path: 'fleet/crew', version: '1' })
@ApiStandardErrors()
export class CrewLoginController {
  constructor(private readonly crew: CrewAppService) {}

  @Put(':id/login')
  @HttpCode(200)
  @RequirePermission(Permission.CREW_MANAGE)
  @ApiOperation({
    summary:
      'Crew-app login for a crew member: their mobile + this password (a second call resets the password and signs them out)',
  })
  setLogin(@UuidParam('id') id: string, @Body(zodBody(CrewLoginSchema)) dto: CrewLoginDto) {
    return this.crew.setLogin(id, dto.password);
  }
}
