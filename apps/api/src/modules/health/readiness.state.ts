import { Injectable } from '@nestjs/common';

/**
 * Tracks whether this instance should receive traffic.
 *
 * Three distinct signals, because conflating them causes outages:
 *  - **startup**: has the process finished booting (migrations checked, pools
 *    warm)? A slow start must not be mistaken for a crash loop.
 *  - **live**: is the process functioning? Never depends on external systems.
 *  - **ready**: should the load balancer send requests? Depends on the database
 *    and flips to `false` the instant we begin draining.
 */
@Injectable()
export class ReadinessState {
  private started = false;
  private ready = false;
  private draining = false;
  readonly bootedAt = Date.now();

  markStarted(): void {
    this.started = true;
  }

  markReady(): void {
    this.started = true;
    this.ready = true;
  }

  /** Called at the very start of shutdown, before we stop accepting sockets. */
  drain(): void {
    this.draining = true;
    this.ready = false;
  }

  get isStarted(): boolean {
    return this.started;
  }
  get isReady(): boolean {
    return this.ready && !this.draining;
  }
  get isDraining(): boolean {
    return this.draining;
  }
  get uptimeSeconds(): number {
    return Math.floor((Date.now() - this.bootedAt) / 1000);
  }
}
