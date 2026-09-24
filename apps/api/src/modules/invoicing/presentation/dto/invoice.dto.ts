import { z } from 'zod';

export const IssueInvoiceSchema = z.object({
  bookingId: z.string().uuid(),
  // NOTE: interState deliberately removed — computed from the booking's
  // route (see InvoiceService.issueForBooking), never client-supplied.
  supplierGstin: z.string().min(15).max(15).optional(),
});
export type IssueInvoiceDto = z.infer<typeof IssueInvoiceSchema>;
