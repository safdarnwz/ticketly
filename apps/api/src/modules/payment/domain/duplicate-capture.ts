/**
 * Is this capture a DUPLICATE payment for a booking that is already paid?
 * Decided on the intent row LOCKED for capture, so two captures racing each
 * other are serialised: the first one records the payment, the second one
 * sees a different captured payment id and is refunded (1004).
 * The same payment id arriving again (webhook redelivery, client callback +
 * webhook) is NOT a duplicate — it is the same money, already booked.
 */
export type CaptureDecision = 'record' | 'already_recorded' | 'duplicate';

export function classifyCapture(
  locked: { status: string; gatewayPaymentId: string | null } | null,
  incomingPaymentId: string,
): CaptureDecision | null {
  if (!locked) return null;
  if (locked.status !== 'captured') return 'record';
  if (!locked.gatewayPaymentId || locked.gatewayPaymentId === incomingPaymentId)
    return 'already_recorded';
  return 'duplicate';
}
