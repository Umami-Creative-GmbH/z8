/**
 * Approval Type Handlers Index
 *
 * Exports all approval type handlers and shared utilities.
 */

export { AbsenceRequestHandler } from "./absence-request.handler";
// Export base handler utilities for creating new handlers
export {
	type ApprovalRequestRow,
	buildBaseConditions,
	buildSLAInfo,
	fetchApprovals,
	getApprovalCount,
} from "./base-handler";
export { TimeCorrectionHandler } from "./time-correction.handler";
export { TravelExpenseClaimHandler } from "./travel-expense-claim.handler";
