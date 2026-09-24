import { Controller, ForbiddenException, Get, Header, Req, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { AppConfig } from '@config';
import { Public } from '@http';
import { Metrics } from '@observability';

/**
 * Prometheus scrape endpoint.
 *
 * Access is restricted to private networks in production. Metrics reveal
 * traffic volume, error rates and internal route names — useful to an attacker
 * profiling the system, and to a competitor estimating booking volume. Ideally
 * this is also bound to an internal-only listener at the ingress.
 */
@ApiExcludeController()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(
    private readonly metrics: Metrics,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(@Req() request: FastifyRequest): Promise<string> {
    if (!this.config.observability.metricsEnabled) throw new ForbiddenException();
    if (this.config.isProduction && !isPrivateAddress(request.ip)) throw new ForbiddenException();
    return this.metrics.scrape();
  }
}

function isPrivateAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  const address = ip.replace(/^::ffff:/, '');
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}
