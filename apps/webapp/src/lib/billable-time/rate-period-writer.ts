import "server-only";

import { sql } from "drizzle-orm";
import { auditLog } from "@/db/schema";
import type { AuditAction } from "@/lib/audit-logger";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import {
	type AppliedRatePeriodChange,
	applyRatePeriodChange,
	type RatePeriodChange,
	type RatePeriodStore,
} from "./rate-periods";

/**
 * Writes one change to an effective-dated rate series inside the caller's
 * transaction (#898 billable rates, #899 cost rates):
 *
 * 1. serializes writers of the series with a transaction-scoped advisory lock
 *    on `seriesKey` (the series may have no row to lock yet),
 * 2. plans and applies the change (`planRatePeriodChange`), with the
 *    database's EXCLUDE constraint as the last line of defence,
 * 3. writes one org audit log entry for a change that changed anything: actor,
 *    target, effective date, old and new value, and the period steps.
 *
 * The caller authorizes the actor, takes `lockBillableTimeSettings(tx, org,
 * "share")` first (the currency read-only rule) and checks that the target
 * belongs to the organization. Rate writers do not take Time Tracking's
 * organization configuration guard (Billable Time ADR 0001).
 */
export async function writeRatePeriodChange<V>(
	tx: Transaction,
	input: {
		seriesKey: string;
		store: RatePeriodStore<V>;
		change: RatePeriodChange<V>;
		equals?: (left: V, right: V) => boolean;
		audit: {
			organizationId: string;
			actorUserId: string;
			entityType: string;
			actions: { set: AuditAction; end: AuditAction };
			/** The employee the series belongs to, if any. */
			employeeId: string | null;
			/** The series' target, e.g. `{ level, projectId }`. */
			target: Record<string, unknown>;
			/** A value as it is shown in the audit trail. */
			describe: (value: V) => unknown;
		};
	},
): Promise<AppliedRatePeriodChange<V>> {
	await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.seriesKey}, 0))`);
	const applied = await applyRatePeriodChange(input.store, input.change, input.equals);
	if (!applied.changed || applied.periodId === null) return applied;

	const { audit, change } = input;
	await tx.insert(auditLog).values({
		organizationId: audit.organizationId,
		entityType: audit.entityType,
		entityId: applied.periodId,
		action: change.kind === "set" ? audit.actions.set : audit.actions.end,
		performedBy: audit.actorUserId,
		employeeId: audit.employeeId,
		changes: JSON.stringify({
			...audit.target,
			effectiveFrom: change.from.toString(),
			old: applied.plan.previous ? audit.describe(applied.plan.previous.value) : null,
			new: change.kind === "set" ? audit.describe(change.value) : null,
		}),
		metadata: JSON.stringify({
			steps: applied.plan.steps.map((step) => {
				if (step.kind === "shorten") {
					return { kind: step.kind, periodId: step.id, to: step.to.toString() };
				}
				if (step.kind === "delete") return { kind: step.kind, periodId: step.id };
				if (step.kind === "update_value") {
					return { kind: step.kind, periodId: step.id, value: audit.describe(step.value) };
				}
				return {
					kind: step.kind,
					periodId: applied.periodId,
					from: step.from.toString(),
					to: step.to?.toString() ?? null,
					value: audit.describe(step.value),
				};
			}),
		}),
	});
	return applied;
}
