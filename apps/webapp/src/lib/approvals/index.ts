/**
 * Unified Approval Center
 *
 * Main entry point for the approval system.
 * Import this to initialize all handlers and access the registry.
 */

// Initialize handlers on import
import "./init";

// Export services
export {
	ApprovalQueryService,
	ApprovalQueryServiceLive,
} from "./application/approval-query.service";
export {
	BulkApprovalService,
	BulkApprovalServiceLive,
} from "./application/bulk-approval.service";
// Export registry
export {
	ApprovalTypeRegistry,
	ApprovalTypeRegistryLive,
	getAllApprovalHandlers,
	getApprovalHandler,
	hasApprovalHandler,
	registerApprovalHandler,
} from "./domain/registry";
// Export SLA utilities
export {
	calculateSLADeadline,
	calculateSLAStatus,
	comparePriority,
	getSLARule,
	getSLAStatusMessage,
	PRIORITY_WEIGHTS,
} from "./domain/sla-calculator";
// Export domain types
export * from "./domain/types";
// Export handlers
export { AbsenceRequestHandler } from "./handlers/absence-request.handler";
export { TimeCorrectionHandler } from "./handlers/time-correction.handler";
export {
	type ApprovalAuditAction,
	type ApprovalAuditEntry,
	ApprovalAuditLogger,
	ApprovalAuditLoggerLive,
} from "./infrastructure/audit-logger";
export {
	approveAbsenceEffect,
	formatAbsenceDateForEmail,
	rejectAbsenceEffect,
} from "./server/absence-approvals";
export {
	getCurrentEmployee,
	getPendingApprovalCounts,
	getPendingApprovals,
} from "./server/queries";
export {
	approveTimeCorrectionEffect,
	calculateCorrectedDurationMinutes,
	rejectTimeCorrectionEffect,
	syncCanonicalWorkCorrection,
} from "./server/time-correction-approvals";
export type { ApprovalWithAbsence, ApprovalWithTimeCorrection } from "./server/types";
