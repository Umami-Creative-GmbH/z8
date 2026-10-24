import { and, eq, inArray } from "drizzle-orm";
import { auditLog } from "@/db/schema/audit";
import { employeeDepartureEvent } from "@/db/schema/employee-lifecycle";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { LifecycleClient } from "./types";

/** `AuditAction.EMPLOYEE_DEACTIVATED` / `EMPLOYEE_REACTIVATED` (the logger module loads the database). */
const DEACTIVATED_AUDIT = "employee.deactivated";
const REACTIVATED_AUDIT = "employee.reactivated";

/**
 * Deactivations and reactivations in the employment history (#1441, D13).
 * Recorded events (`employee_departure_event`, written by Deactivate and
 * Reactivate) come first; for older ones the `employee.deactivated` /
 * `employee.reactivated` audit entries, where they survive (audit rows are
 * kept 365 days). An audit entry carrying the id of a recorded event is the
 * same change and is shown once.
 */

export type LifecycleHistoryEvent = {
	kind: "deactivated" | "reactivated";
	/** ISO instant; shown in the organization's time zone. */
	at: string;
};

export type LifecycleHistory = { timeZone: string; events: LifecycleHistoryEvent[] };

type LifecycleRecord = {
	kind: "employee_deactivated" | "employee_reactivated";
	at: Instant;
	requestId: string;
	deactivationId: string | null;
};

type LifecycleAudit = {
	action: string;
	at: Instant;
	metadata: Record<string, unknown>;
};

/** Recorded events plus the audit entries no event covers, newest first. */
export function mergeLifecycleHistory(input: {
	records: LifecycleRecord[];
	audits: LifecycleAudit[];
}): LifecycleHistoryEvent[] {
	const recordedDeactivations = new Set(
		input.records.flatMap((record) =>
			record.kind === "employee_deactivated" && record.deactivationId
				? [record.deactivationId]
				: [],
		),
	);
	const recordedReactivations = new Set(
		input.records.flatMap((record) =>
			record.kind === "employee_reactivated" ? [record.requestId] : [],
		),
	);

	const events: Array<{ kind: LifecycleHistoryEvent["kind"]; at: Instant }> = input.records.map(
		(record) => ({
			kind: record.kind === "employee_deactivated" ? "deactivated" : "reactivated",
			at: record.at,
		}),
	);
	for (const audit of input.audits) {
		if (audit.action === DEACTIVATED_AUDIT) {
			const id = audit.metadata.deactivationId;
			if (typeof id === "string" && recordedDeactivations.has(id)) continue;
			events.push({ kind: "deactivated", at: audit.at });
		} else if (audit.action === REACTIVATED_AUDIT) {
			const id = audit.metadata.reactivationRequestId;
			if (typeof id === "string" && recordedReactivations.has(id)) continue;
			events.push({ kind: "reactivated", at: audit.at });
		}
	}

	return events
		.toSorted((left, right) => right.at.epochMilliseconds - left.at.epochMilliseconds)
		.map((event) => ({ kind: event.kind, at: event.at.toString() }));
}

function parseMetadata(value: string | null): Record<string, unknown> {
	if (!value) return {};
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** The employee's deactivations and reactivations in the organization, newest first. */
export async function loadLifecycleHistory(
	database: LifecycleClient,
	input: { organizationId: string; employeeId: string },
): Promise<LifecycleHistory> {
	const records = await database
		.select({
			kind: employeeDepartureEvent.kind,
			occurredAt: employeeDepartureEvent.occurredAt,
			requestId: employeeDepartureEvent.requestId,
			metadata: employeeDepartureEvent.metadata,
		})
		.from(employeeDepartureEvent)
		.where(
			and(
				eq(employeeDepartureEvent.organizationId, input.organizationId),
				eq(employeeDepartureEvent.employeeId, input.employeeId),
				inArray(employeeDepartureEvent.kind, ["employee_deactivated", "employee_reactivated"]),
			),
		);
	const audits = await database
		.select({
			action: auditLog.action,
			timestamp: auditLog.timestamp,
			metadata: auditLog.metadata,
		})
		.from(auditLog)
		.where(
			and(
				eq(auditLog.organizationId, input.organizationId),
				eq(auditLog.entityType, "employee"),
				eq(auditLog.entityId, input.employeeId),
				inArray(auditLog.action, [DEACTIVATED_AUDIT, REACTIVATED_AUDIT]),
			),
		);

	const events = mergeLifecycleHistory({
		records: records.map((record) => {
			const metadata = (record.metadata ?? {}) as Record<string, unknown>;
			return {
				kind: record.kind as LifecycleRecord["kind"],
				at: instantFromDate(new Date(record.occurredAt)),
				requestId: record.requestId,
				deactivationId:
					typeof metadata.deactivationId === "string" ? metadata.deactivationId : null,
			};
		}),
		audits: audits.map((audit) => ({
			action: audit.action,
			at: instantFromDate(new Date(audit.timestamp)),
			metadata: parseMetadata(audit.metadata),
		})),
	});
	const timeZone = await loadOrganizationTimezone(database, input.organizationId);
	return { timeZone, events };
}
