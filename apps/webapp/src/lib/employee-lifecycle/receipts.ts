import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
	type deactivationReasons,
	employeeDeactivation,
	employeeDepartureEvent,
} from "@/db/schema/employee-lifecycle";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import type { LifecycleActor, LifecycleClient } from "./types";

type LedgerReader = Pick<LifecycleClient, "select">;

/** Stable SHA-256 over actor, command and canonical (key-sorted) input. */
export function requestFingerprint(actor: LifecycleActor, command: string, input: object): string {
	const canonical = JSON.stringify({
		actor: actor.userId,
		command,
		input: sortKeys(input),
	});
	return createHash("sha256").update(canonical).digest("hex");
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, sortKeys(entry)]),
		);
	}
	return value;
}

/**
 * A departure command's receipt is event index 0 for the request. Replaying
 * the same payload returns the original result; a different payload under the
 * same request ID throws the caller's conflict error.
 */
export async function readReceipt<T>(
	tx: LedgerReader,
	actor: LifecycleActor,
	requestId: string,
	fingerprint: string,
	conflict: () => Error,
): Promise<T | null> {
	const [receipt] = await tx
		.select({
			fingerprint: employeeDepartureEvent.requestFingerprint,
			result: employeeDepartureEvent.result,
		})
		.from(employeeDepartureEvent)
		.where(
			and(
				eq(employeeDepartureEvent.organizationId, actor.organizationId),
				eq(employeeDepartureEvent.requestId, requestId),
				eq(employeeDepartureEvent.eventIndex, 0),
			),
		);
	if (!receipt) return null;
	if (receipt.fingerprint !== fingerprint) throw conflict();
	return receipt.result as T;
}

/**
 * Appends an event of a request. Index 0 is the receipt and carries the
 * fingerprint and the result; positive indices are further events.
 */
export async function writeReceipt(
	tx: Pick<LifecycleClient, "insert">,
	input: {
		actor: LifecycleActor;
		employeeId: string;
		employmentPeriodId: string;
		departureId: string | null;
		revision: number | null;
		requestId: string;
		fingerprint: string;
		kind: typeof employeeDepartureEvent.$inferInsert.kind;
		occurredAt: Date;
		result: Record<string, unknown>;
		eventIndex?: number;
		metadata?: Record<string, unknown>;
	},
) {
	await tx.insert(employeeDepartureEvent).values({
		organizationId: input.actor.organizationId,
		employeeId: input.employeeId,
		employmentPeriodId: input.employmentPeriodId,
		departureId: input.departureId,
		requestId: input.requestId,
		eventIndex: input.eventIndex ?? 0,
		revision: input.revision,
		kind: input.kind,
		actorUserId: input.actor.userId,
		occurredAt: input.occurredAt,
		metadata: input.metadata ?? {},
		requestFingerprint: input.eventIndex ? null : input.fingerprint,
		result: input.eventIndex ? null : input.result,
	});
}

// ---- deactivation ledger (#1440) --------------------------------------------

export type DeactivationLedgerReason = (typeof deactivationReasons)[number];

/** One `employee_deactivation` row. */
export type DeactivationLedgerEntry = {
	id: string;
	organizationId: string;
	employeeId: string;
	employmentPeriodId: string | null;
	deactivatedAt: Instant;
	createdBy: string;
	reason: DeactivationLedgerReason;
	requestId: string;
	replacementManagers: Record<string, string>;
	/** What a replayed request returns; null until the outcome is recorded. */
	result: Record<string, unknown> | null;
	/** The applied consequences (`DeactivationApplied`); the #1441 checklist source. */
	applied: Record<string, unknown> | null;
	reactivatedAt: Instant | null;
	reactivatedBy: string | null;
	reactivationRequestId: string | null;
};

/** The request ID was used before with a different payload. */
export class DeactivationRequestConflictError extends Error {
	readonly code = "request_conflict" as const;
	constructor() {
		super("request_conflict");
		this.name = "DeactivationRequestConflictError";
	}
}

const ledgerColumns = {
	id: employeeDeactivation.id,
	organizationId: employeeDeactivation.organizationId,
	employeeId: employeeDeactivation.employeeId,
	employmentPeriodId: employeeDeactivation.employmentPeriodId,
	deactivatedAt: employeeDeactivation.deactivatedAt,
	createdBy: employeeDeactivation.createdBy,
	reason: employeeDeactivation.reason,
	requestId: employeeDeactivation.requestId,
	requestFingerprint: employeeDeactivation.requestFingerprint,
	replacementManagers: employeeDeactivation.replacementManagers,
	result: employeeDeactivation.result,
	applied: employeeDeactivation.applied,
	reactivatedAt: employeeDeactivation.reactivatedAt,
	reactivatedBy: employeeDeactivation.reactivatedBy,
	reactivationRequestId: employeeDeactivation.reactivationRequestId,
};

type LedgerRow = Omit<typeof employeeDeactivation.$inferSelect, "createdAt">;

function toEntry(row: LedgerRow): DeactivationLedgerEntry {
	return {
		id: row.id,
		organizationId: row.organizationId,
		employeeId: row.employeeId,
		employmentPeriodId: row.employmentPeriodId,
		deactivatedAt: instantFromDate(new Date(row.deactivatedAt)),
		createdBy: row.createdBy,
		reason: row.reason,
		requestId: row.requestId,
		replacementManagers: row.replacementManagers ?? {},
		result: row.result,
		applied: row.applied,
		reactivatedAt: row.reactivatedAt ? instantFromDate(new Date(row.reactivatedAt)) : null,
		reactivatedBy: row.reactivatedBy,
		reactivationRequestId: row.reactivationRequestId,
	};
}

/**
 * Records a deactivation in the caller's transaction. The request ID is
 * unique per organization, so a concurrent duplicate submission fails on the
 * index instead of applying twice; callers read the request first.
 */
export async function insertDeactivation(
	tx: Pick<LifecycleClient, "insert">,
	input: {
		organizationId: string;
		employeeId: string;
		employmentPeriodId: string | null;
		deactivatedAt: Instant;
		createdBy: string;
		reason: DeactivationLedgerReason;
		requestId: string;
		requestFingerprint: string;
		replacementManagers: Readonly<Record<string, string>>;
	},
): Promise<{ id: string }> {
	const [row] = await tx
		.insert(employeeDeactivation)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			employmentPeriodId: input.employmentPeriodId,
			deactivatedAt: dateFromInstant(input.deactivatedAt),
			createdBy: input.createdBy,
			reason: input.reason,
			requestId: input.requestId,
			requestFingerprint: input.requestFingerprint,
			replacementManagers: { ...input.replacementManagers },
		})
		.returning({ id: employeeDeactivation.id });
	if (!row) throw new Error("Deactivation was not recorded");
	return row;
}

/**
 * The deactivation recorded under a request ID, for replay. A different
 * payload under the same request ID is refused.
 */
export async function readDeactivationByRequest(
	tx: LedgerReader,
	input: { organizationId: string; requestId: string; requestFingerprint: string },
): Promise<DeactivationLedgerEntry | null> {
	const [row] = await tx
		.select(ledgerColumns)
		.from(employeeDeactivation)
		.where(
			and(
				eq(employeeDeactivation.organizationId, input.organizationId),
				eq(employeeDeactivation.requestId, input.requestId),
			),
		);
	if (!row) return null;
	if (row.requestFingerprint !== input.requestFingerprint) {
		throw new DeactivationRequestConflictError();
	}
	return toEntry(row);
}

/** Stores what was applied and what a replay returns, in the same transaction. */
export async function recordDeactivationOutcome(
	tx: Pick<LifecycleClient, "update">,
	input: {
		organizationId: string;
		deactivationId: string;
		applied: Record<string, unknown>;
		result: Record<string, unknown>;
	},
): Promise<void> {
	await tx
		.update(employeeDeactivation)
		.set({ applied: input.applied, result: input.result })
		.where(
			and(
				eq(employeeDeactivation.organizationId, input.organizationId),
				eq(employeeDeactivation.id, input.deactivationId),
			),
		);
}

/** The employee's latest deactivation that no reactivation has ended. */
export async function readOpenDeactivation(
	tx: LedgerReader,
	input: { organizationId: string; employeeId: string },
): Promise<DeactivationLedgerEntry | null> {
	const [row] = await tx
		.select(ledgerColumns)
		.from(employeeDeactivation)
		.where(
			and(
				eq(employeeDeactivation.organizationId, input.organizationId),
				eq(employeeDeactivation.employeeId, input.employeeId),
				isNull(employeeDeactivation.reactivatedAt),
			),
		)
		.orderBy(desc(employeeDeactivation.deactivatedAt), desc(employeeDeactivation.createdAt))
		.limit(1);
	return row ? toEntry(row) : null;
}

/**
 * Ends the employee's open deactivations on reactivation and returns their
 * ids. Pending handovers of a reactivated deactivation then stop, like a
 * departure's after a rehire. Nothing else is restored.
 */
export async function markDeactivationReactivated(
	tx: Pick<LifecycleClient, "update">,
	input: {
		organizationId: string;
		employeeId: string;
		reactivatedAt: Instant;
		reactivatedBy: string | null;
		reactivationRequestId: string | null;
	},
): Promise<string[]> {
	const rows = await tx
		.update(employeeDeactivation)
		.set({
			reactivatedAt: dateFromInstant(input.reactivatedAt),
			reactivatedBy: input.reactivatedBy,
			reactivationRequestId: input.reactivationRequestId,
		})
		.where(
			and(
				eq(employeeDeactivation.organizationId, input.organizationId),
				eq(employeeDeactivation.employeeId, input.employeeId),
				isNull(employeeDeactivation.reactivatedAt),
			),
		)
		.returning({ id: employeeDeactivation.id });
	return rows.map((row) => row.id);
}
