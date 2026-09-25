import { describe, expect, it, vi } from 'vitest';

import { MaterializationService } from '../application/services/materialization.service';

/** The worker's daily horizon job: one broken service must not stop the others. */
describe('MaterializationService.materialiseAllActive', () => {
  function service(listed: string[]) {
    const logger = { forContext: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) };
    const svc = new MaterializationService(
      {} as never,
      { listActive: vi.fn(async () => listed.map((id) => ({ id }))) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      logger as never,
      {} as never,
    );
    return svc;
  }

  it('adds up the trips of every active service', async () => {
    const svc = service(['a', 'b']);
    vi.spyOn(svc, 'materialiseService').mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    await expect(svc.materialiseAllActive()).resolves.toEqual({
      services: 2,
      trips: 5,
      failures: 0,
    });
  });

  it('keeps going after a service fails, and counts the failure', async () => {
    const svc = service(['a', 'b', 'c']);
    vi.spyOn(svc, 'materialiseService')
      .mockResolvedValueOnce(4)
      .mockRejectedValueOnce(new Error('layout missing'))
      .mockResolvedValueOnce(1);
    await expect(svc.materialiseAllActive()).resolves.toEqual({
      services: 3,
      trips: 5,
      failures: 1,
    });
  });

  it('does nothing when the operator has no active service', async () => {
    const svc = service([]);
    await expect(svc.materialiseAllActive()).resolves.toEqual({
      services: 0,
      trips: 0,
      failures: 0,
    });
  });
});
