/**
 * Approval Audit Logger
 *
 * Logs all approval state transitions to the audit log table.
 */

import { Context, Effect, Layer } from "effect";
import { auditLog } from "@/db/schema";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import type { ApprovalStatus, ApprovalType } from "../domain/types";
import type { AnyAppError } from "@/lib/effect/errors";
import type { ApprovalDbService } from "../server/types";

// ============================================
// TYPES
// ============================================

export type ApprovalAuditAction =
	| "approve"
	| "reject"
	| "escalate"
	| "bulk_approve"
	| "bulk_reject"
	| "cancel";

export interface ApprovalAuditEntry {
	organizationId: string;
	approvalId: string;
	approvalType: ApprovalType;
	entityId: string;
	action: ApprovalAuditAction;
	performedBy: string;
	previousStatus: ApprovalStatus;
	newStatus: ApprovalStatus;
	reason?: string;
	metadata?: Record<string, unknown>;
	ipAddress?: string;
	userAgent?: string;
}

export interface ApprovalPolicyAuditEvent {
	organizationId: string;
	eventName: string;
	policyId?: string;
	chainId?: string;
	stageId?: string;
	entityType: string;
	entityId: string;
	actorUserId: string;
	actorEmployeeId?: string;
	previousStatus?: string;
	newStatus?: string;
	createdAt: Date;
}

// ============================================
// SERVICE DEFINITION
// ============================================

export class ApprovalAuditLogger extends Context.Tag("ApprovalAuditLogger")<
	ApprovalAuditLogger,
	{
		/**
		 * Log an approval action.
		 */
		readonly log: (entry: ApprovalAuditEntry) => Effect.Effect<void, AnyAppError, never>;

		/**
		 * Log multiple actions in batch (for bulk operations).
		 */
		readonly logBatch: (entries: ApprovalAuditEntry[]) => Effect.Effect<void, AnyAppError, never>;
	}
>() {}

function normalizeEntry(entry: ApprovalAuditEntry) {
	const bulkOperation = entry.action === "bulk_approve" || entry.action === "bulk_reject";
	const action = entry.action === "bulk_approve"
		? "approve"
		: entry.action === "bulk_reject"
			? "reject"
			: entry.action;
	const metadata = {
		...(entry.metadata ?? {}),
		...(bulkOperation ? { bulkOperation: true } : {}),
	};

	return {
		organizationId: entry.organizationId,
		entityType: "approval_request" as const,
		entityId: entry.approvalId,
		action,
		performedBy: entry.performedBy,
		changes: JSON.stringify({
			from: entry.previousStatus,
			to: entry.newStatus,
			approvalType: entry.approvalType,
			targetEntityId: entry.entityId,
			...(entry.reason && { reason: entry.reason }),
		}),
		metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
		ipAddress: entry.ipAddress || null,
		userAgent: entry.userAgent || null,
		timestamp: new Date(),
	};
}

function normalizePolicyEvent(event: ApprovalPolicyAuditEvent) {
	return {
		organizationId: event.organizationId,
		entityType: event.entityType,
		entityId: event.entityId,
		action: event.eventName,
		performedBy: event.actorUserId,
		employeeId: event.actorEmployeeId ?? null,
		changes:
			event.previousStatus || event.newStatus
				? JSON.stringify({ from: event.previousStatus ?? null, to: event.newStatus ?? null })
				: null,
		metadata: JSON.stringify({
			eventName: event.eventName,
			...(event.policyId ? { policyId: event.policyId } : {}),
			...(event.chainId ? { chainId: event.chainId } : {}),
			...(event.stageId ? { stageId: event.stageId } : {}),
		}),
		ipAddress: null,
		userAgent: null,
		timestamp: event.createdAt,
	};
}

export function logApprovalPolicyEvent(
	dbService: ApprovalDbService,
	event: ApprovalPolicyAuditEvent,
): Effect.Effect<void, AnyAppError, never> {
	return dbService.query("logApprovalPolicyEvent", async () => {
		const relationalQuery = (dbService.db as { query?: Record<string, unknown> }).query;
		if (!relationalQuery || !("auditLog" in relationalQuery)) {
			return;
		}

		await dbService.db.insert(auditLog).values(normalizePolicyEvent(event));
	});
}

export function createApprovalAuditLogger(dbService: ApprovalDbService) {
	const logSingle = (entry: ApprovalAuditEntry) =>
		dbService.query("logApprovalAudit", async () => {
			await dbService.db.insert(auditLog).values(normalizeEntry(entry));
		});

	return ApprovalAuditLogger.of({
		log: (entry) => logSingle(entry),

		logBatch: (entries) =>
			Effect.gen(function* (_) {
				if (entries.length === 0) return;

				yield* _(
					dbService.query("logApprovalAuditBatch", async () => {
						await dbService.db.insert(auditLog).values(entries.map(normalizeEntry));
					}),
				);
			}),
	});
}

// ============================================
// LIVE IMPLEMENTATION
// ============================================

export const ApprovalAuditLoggerLive = Layer.effect(
	ApprovalAuditLogger,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return createApprovalAuditLogger(dbService);
	}),
).pipe(Layer.provide(DatabaseServiceLive));
