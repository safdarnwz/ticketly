import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, RequirePlatformAdmin, zodBody } from '@http';
import { getUserId } from '@kernel';

import { PlatformPoliciesService } from '../application/platform-policies.service';
import {
  AgentCreditPolicySchema,
  DataRetentionSchema,
  GstSlabsSchema,
  IpAllowlistSchema,
  OtaReleasePolicySchema,
  PasswordPolicySchema,
  SuspiciousLoginSchema,
  type AgentCreditPolicyDto,
  type DataRetentionDto,
  type GstSlabsDto,
  type IpAllowlistDto,
  type OtaReleasePolicyDto,
  type PasswordPolicyDto,
  type SuspiciousLoginDto,
} from './dto/platform-policies.dto';

/** Platform-wide policies (#26–#29, #33, #42, #44, #54, #75). */
@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/policies', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class PlatformPoliciesController {
  constructor(private readonly policies: PlatformPoliciesService) {}

  @Get()
  @ApiOperation({ summary: 'Every platform policy, with defaults filled in' })
  async all() {
    const [
      password,
      adminIpAllowlist,
      suspiciousLogin,
      gstSlabs,
      agentCredit,
      dataRetention,
      otaRelease,
    ] = await Promise.all([
      this.policies.passwordPolicy(),
      this.policies.adminIpAllowlist(),
      this.policies.suspiciousLoginPolicy(),
      this.policies.gstSlabs(),
      this.policies.agentCreditPolicy(),
      this.policies.dataRetention(),
      this.policies.otaReleasePolicy(),
    ]);
    return {
      password,
      adminIpAllowlist,
      suspiciousLogin,
      gstSlabs,
      agentCredit,
      dataRetention,
      otaRelease,
    };
  }

  @Put('password')
  @ApiOperation({ summary: 'Password minimum length, complexity and expiry' })
  password(@Body(zodBody(PasswordPolicySchema)) dto: PasswordPolicyDto) {
    return this.policies.setPasswordPolicy(dto, actor());
  }

  @Put('admin-ip-allowlist')
  @ApiOperation({ summary: 'IPs / CIDR ranges platform admins may sign in from' })
  async ipAllowlist(@Body(zodBody(IpAllowlistSchema)) dto: IpAllowlistDto) {
    return { entries: await this.policies.setAdminIpAllowlist(dto.entries, actor()) };
  }

  @Put('suspicious-login')
  @ApiOperation({ summary: 'Alerts for repeated failed logins and new admin IPs' })
  suspiciousLogin(@Body(zodBody(SuspiciousLoginSchema)) dto: SuspiciousLoginDto) {
    return this.policies.setSuspiciousLoginPolicy(dto, actor());
  }

  @Put('gst-slabs')
  @ApiOperation({ summary: 'Global GST tax slabs' })
  async gstSlabs(@Body(zodBody(GstSlabsSchema)) dto: GstSlabsDto) {
    return { slabs: await this.policies.setGstSlabs(dto.slabs, actor()) };
  }

  @Put('agent-credit')
  @ApiOperation({ summary: 'Default agent credit limit and platform cap' })
  agentCredit(@Body(zodBody(AgentCreditPolicySchema)) dto: AgentCreditPolicyDto) {
    return this.policies.setAgentCreditPolicy(dto, actor());
  }

  @Put('data-retention')
  @ApiOperation({ summary: 'Days operational logs are kept (null = forever)' })
  dataRetention(@Body(zodBody(DataRetentionSchema)) dto: DataRetentionDto) {
    const patch = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    return this.policies.setDataRetention(patch, actor());
  }

  @Put('ota-release')
  @ApiOperation({ summary: 'Default share of each trip OTAs / GDS partners may sell' })
  otaRelease(@Body(zodBody(OtaReleasePolicySchema)) dto: OtaReleasePolicyDto) {
    return this.policies.setOtaReleasePolicy(dto, actor());
  }
}

function actor(): string | null {
  return getUserId() ?? null;
}
