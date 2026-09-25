import { describe, expect, it } from 'vitest';

import { isUuid } from '@kernel';

import { documentEventId } from '../application/services/notification.service';

describe('documentEventId', () => {
  const event = '01a0d871-9342-7229-ba1e-0e24a045eb1f';
  it('is a valid, stable uuid per (event, document)', () => {
    const a = documentEventId(event, 'eticket');
    expect(isUuid(a)).toBe(true);
    expect(documentEventId(event, 'eticket')).toBe(a);
  });
  it('differs between the ticket and the invoice, and between events', () => {
    expect(documentEventId(event, 'eticket')).not.toBe(documentEventId(event, 'invoice'));
    expect(documentEventId(event, 'invoice')).not.toBe(
      documentEventId('01a0d871-9342-7229-ba1e-0e24a045eb20', 'invoice'),
    );
    expect(documentEventId(event, 'eticket')).not.toBe(event);
  });
});
