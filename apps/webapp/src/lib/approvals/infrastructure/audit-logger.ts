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

// ============================================
// TYPES
// ============================================

export type ApprovalAuditAction =
	| "approve"
	| "reject"
	| "escalate"
	| "bulk_approve"
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

// ============================================
// SERVICE DEFINITION
// ============================================

export class ApprovalAuditLogger extends Context.Tag("ApprovalAuditLogger")<
	ApprovalAuditLogger,
	{
		/**
		 * Log an approval action.
		 */
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		readonly log: (entry: ApprovalAuditEntry) => Effect.Effect<void, AnyAppError, any>;

		/**
		 * Log multiple actions in batch (for bulk operations).
		 */
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		readonly logBatch: (entries: ApprovalAuditEntry[]) => Effect.Effect<void, AnyAppError, any>;
	}
>() {}

// ============================================
// LIVE IMPLEMENTATION
// ============================================

export const ApprovalAuditLoggerLive = Layer.effect(
	ApprovalAuditLogger,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		const logSingle = (entry: ApprovalAuditEntry) =>
			dbService.query("logApprovalAudit", async () => {
				await dbService.db.insert(auditLog).values({
					organizationId: entry.organizationId,
					entityType: "approval_request",
					entityId: entry.approvalId,
					action: entry.action,
					performedBy: entry.performedBy,
					changes: JSON.stringify({
						from: entry.previousStatus,
						to: entry.newStatus,
						approvalType: entry.approvalType,
						targetEntityId: entry.entityId,
						...(entry.reason && { reason: entry.reason }),
					}),
					metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
					ipAddress: entry.ipAddress || null,
					userAgent: entry.userAgent || null,
					timestamp: new Date(),
				});
			});

		return ApprovalAuditLogger.of({
			log: (entry) => logSingle(entry),

			logBatch: (entries) =>
				Effect.gen(function* (_) {
					if (entries.length === 0) return;

					yield* _(
						dbService.query("logApprovalAuditBatch", async () => {
							await dbService.db.insert(auditLog).values(
								entries.map((entry) => ({
									organizationId: entry.organizationId,
									entityType: "approval_request" as const,
									entityId: entry.approvalId,
									action: entry.action,
									performedBy: entry.performedBy,
									changes: JSON.stringify({
										from: entry.previousStatus,
										to: entry.newStatus,
										approvalType: entry.approvalType,
										targetEntityId: entry.entityId,
										...(entry.reason && { reason: entry.reason }),
									}),
									metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
									ipAddress: entry.ipAddress || null,
									userAgent: entry.userAgent || null,
									timestamp: new Date(),
								})),
							);
						}),
					);
				}),
		});
	}),
).pipe(Layer.provide(DatabaseServiceLive));
