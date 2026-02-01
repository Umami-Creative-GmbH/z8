/**
 * Approval Type Handlers Index
 *
 * Exports all approval type handlers and shared utilities.
 */

export { AbsenceRequestHandler } from "./absence-request.handler";
export { TimeCorrectionHandler } from "./time-correction.handler";

// Export base handler utilities for creating new handlers
export {
	fetchApprovals,
	getApprovalCount,
	buildSLAInfo,
	buildBaseConditions,
	type ApprovalRequestRow,
} from "./base-handler";
