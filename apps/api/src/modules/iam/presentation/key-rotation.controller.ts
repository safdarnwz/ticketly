import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, RequirePlatformAdmin } from '@http';

import { KeyRotationService } from '../application/services/key-rotation.service';

/** Encryption key rotation (#120). */
@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/security/encryption', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class KeyRotationController {
  constructor(private readonly rotation: KeyRotationService) {}

  @Get()
  @ApiOperation({ summary: 'Current key id and how many encrypted values each key still holds' })
  status() {
    return this.rotation.status();
  }

  @Post('reencrypt')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Rewrite values under retired keys with the current key; repeat until remaining is 0, then drop the old key',
  })
  reencrypt() {
    return this.rotation.reencrypt();
  }
}
