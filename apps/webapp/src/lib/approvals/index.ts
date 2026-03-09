/**
 * Unified Approval Center
 *
 * Main entry point for the approval system.
 * Import this to initialize all handlers and access the registry.
 */

// Initialize handlers on import
import "./init";

// Export domain types
export * from "./domain/types";

// Export registry
export {
	ApprovalTypeRegistry,
	ApprovalTypeRegistryLive,
	registerApprovalHandler,
	getApprovalHandler,
	getAllApprovalHandlers,
	hasApprovalHandler,
} from "./domain/registry";

// Export SLA utilities
export {
	getSLARule,
	calculateSLADeadline,
	calculateSLAStatus,
	getSLAStatusMessage,
	comparePriority,
	PRIORITY_WEIGHTS,
} from "./domain/sla-calculator";

// Export handlers
export { AbsenceRequestHandler } from "./handlers/absence-request.handler";
export { TimeCorrectionHandler } from "./handlers/time-correction.handler";

// Export services
export {
	ApprovalQueryService,
	ApprovalQueryServiceLive,
} from "./application/approval-query.service";

export {
	BulkApprovalService,
	BulkApprovalServiceLive,
} from "./application/bulk-approval.service";

export type { ApprovalWithAbsence, ApprovalWithTimeCorrection } from "./server/types";
export {
	approveAbsenceEffect,
	rejectAbsenceEffect,
	formatAbsenceDateForEmail,
} from "./server/absence-approvals";
export {
	approveTimeCorrectionEffect,
	rejectTimeCorrectionEffect,
	calculateCorrectedDurationMinutes,
	syncCanonicalWorkCorrection,
} from "./server/time-correction-approvals";
export { getPendingApprovalCounts, getPendingApprovals, getCurrentEmployee } from "./server/queries";

export {
	ApprovalAuditLogger,
	ApprovalAuditLoggerLive,
	type ApprovalAuditAction,
	type ApprovalAuditEntry,
} from "./infrastructure/audit-logger";
