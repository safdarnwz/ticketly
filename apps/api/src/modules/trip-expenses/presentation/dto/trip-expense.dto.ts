import { z } from 'zod';
import { EXPENSE_CATEGORIES } from '../../domain/pnl';
import { localDateQuery, queryFlag } from '@http';

export const AddExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amountMinor: z.number().int().positive(),
  note: z.string().trim().max(300).optional(),
  receiptFileId: z.string().uuid().optional(),
});
export type AddExpenseDto = z.infer<typeof AddExpenseSchema>;

export const VoidExpenseSchema = z.object({ reason: z.string().trim().min(5).max(300) });
export type VoidExpenseDto = z.infer<typeof VoidExpenseSchema>;

export const ListExpensesQuerySchema = z.object({ includeVoided: queryFlag });
export type ListExpensesQueryDto = z.infer<typeof ListExpensesQuerySchema>;

export const PnlReportQuerySchema = z.object({
  from: localDateQuery,
  to: localDateQuery,
  groupBy: z.enum(['trip', 'route', 'vehicle']).default('route'),
  routeId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
});
export type PnlReportQueryDto = z.infer<typeof PnlReportQuerySchema>;
