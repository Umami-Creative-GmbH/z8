import { auditLog } from "@/db/schema";
import {
	type AuditAction,
	type AuditLogEntry,
	forwardAuditToExternalService,
} from "@/lib/audit-logger";

/** Any client that can insert inside the caller's transaction. */
export type AuditInsertClient = {
	insert(table: typeof auditLog): {
		values(row: typeof auditLog.$inferInsert): PromiseLike<unknown>;
	};
};

/** One audit entry as a store records it. */
export type AuditRecord = {
	organizationId: string;
	action: AuditAction;
	actorUserId: string;
	targetType: NonNullable<AuditLogEntry["targetType"]>;
	targetId: string;
	employeeId?: string | null;
	changes?: Record<string, unknown> | null;
	metadata?: Record<string, unknown> | null;
	ipAddress?: string | null;
	userAgent?: string | null;
};

/**
 * The audit entries of one write (spec #761 kiosk, PIN, kiosk-only and
 * assigned-location stores). Each row is inserted in the write's own
 * transaction, so the row commits or rolls back with the change; the entry
 * reaches the external audit service only once that transaction committed.
 */
export class AuditTrail {
	readonly #committedLater: AuditLogEntry[] = [];

	async record(tx: AuditInsertClient, record: AuditRecord): Promise<void> {
		const timestamp = new Date();
		await tx.insert(auditLog).values({
			organizationId: record.organizationId,
			entityType: record.targetType,
			entityId: record.targetId,
			action: record.action,
			performedBy: record.actorUserId,
			employeeId: record.employeeId ?? null,
			changes: record.changes ? JSON.stringify(record.changes) : null,
			metadata: record.metadata ? JSON.stringify(record.metadata) : null,
			ipAddress: record.ipAddress ?? null,
			userAgent: record.userAgent ?? null,
			timestamp,
		});
		this.#committedLater.push({
			action: record.action,
			actorId: record.actorUserId,
			employeeId: record.employeeId ?? undefined,
			targetId: record.targetId,
			targetType: record.targetType,
			organizationId: record.organizationId,
			changes: record.changes ?? undefined,
			metadata: record.metadata ?? undefined,
			ipAddress: record.ipAddress ?? undefined,
			userAgent: record.userAgent ?? undefined,
			timestamp,
		});
	}

	/** Hands the recorded entries to the external audit service; only after the commit. */
	forwardCommitted(): void {
		for (const entry of this.#committedLater.splice(0)) forwardAuditToExternalService(entry);
	}
}

/**
 * Runs a write whose transaction completes inside `run`, then forwards its
 * audit entries. A rejected `run` (a rolled-back transaction) forwards nothing.
 */
export async function withAuditTrail<T>(run: (audit: AuditTrail) => Promise<T>): Promise<T> {
	const audit = new AuditTrail();
	const result = await run(audit);
	audit.forwardCommitted();
	return result;
}
