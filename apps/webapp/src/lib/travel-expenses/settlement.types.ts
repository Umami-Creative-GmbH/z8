/**
 * Settlement entry kinds (#612). Kept free of imports: the database schema
 * references these, and every runtime image that loads the schema would
 * otherwise need the settlement calculation's dependencies. `settlement.ts`
 * re-exports them.
 */

export const SETTLEMENT_ENTRY_KINDS = ["reimbursement", "recovery"] as const;
export type SettlementEntryKind = (typeof SETTLEMENT_ENTRY_KINDS)[number];
