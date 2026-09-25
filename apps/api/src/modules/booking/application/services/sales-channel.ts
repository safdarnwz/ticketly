import { Permission } from '@contracts';
import { ForbiddenError, getContext, hasPermission } from '@kernel';

/**
 * Which sales channel a hold may claim. The channel decides sales controls
 * (a trip can be closed to OTAs but open on the website), partner quotas and
 * reporting, so the caller cannot simply pick one:
 *   - direct_web / direct_app — anyone (the storefront and apps);
 *   - backoffice — operator staff who may create bookings;
 *   - ota — only a distribution partner signed in with its API key (the
 *     GDS API sets its own `gds:<partner>` channel).
 */
export function allowedSalesChannel(requested: string | undefined): string | undefined {
  if (!requested || requested === 'direct_web' || requested === 'direct_app') return requested;
  if (requested === 'backoffice') {
    if (hasPermission(Permission.BOOKING_CREATE)) return requested;
    throw new ForbiddenError({
      message: 'Only operator staff can book on the back-office channel',
    });
  }
  if (requested === 'ota') {
    const actor = getContext()?.actorType;
    if (actor === 'api_key' || actor === 'channel_partner') return requested;
    throw new ForbiddenError({ message: 'Partner bookings go through the partner (GDS) API' });
  }
  throw new ForbiddenError({ message: `Unknown sales channel '${requested}'` });
}
