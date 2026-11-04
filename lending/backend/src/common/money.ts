/**
 * All money is stored as integer paise in BIGINT columns (₹1 = 100 paise).
 * Postgres returns BIGINT as a string; this transformer turns it back into a number.
 * Loan amounts are far below Number.MAX_SAFE_INTEGER, so no precision is lost.
 */
export const paiseTransformer = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? v : Number(v)),
};

export const rupeesToPaise = (rupees: number) => Math.round(rupees * 100);
export const paiseToRupees = (paise: number) => paise / 100;
export const formatInr = (paise: number) =>
  '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
