import "server-only";
import { eq, sql } from "drizzle-orm";
import {
	drivingAuthorization,
	drivingLicenceCheck,
	drivingLicenceSubject,
} from "@/db/schema/driving-licence-checks";
import { drivingLicenceRetention } from "@/db/schema/driving-licence-retention";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import type { DrivingLicenceTransaction } from "./verifiers";

/** Caller holds the organization driving-control lock. Metadata is separate from immutable evidence. */
export async function beginDrivingLicenceRetentionChange(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	now: Instant,
) {
	return reconcile(tx, organizationId, now);
}
export async function finishDrivingLicenceRetentionChange(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	now: Instant,
	activeBefore: ReadonlySet<string>,
) {
	return reconcile(tx, organizationId, now, activeBefore);
}
async function reconcile(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	now: Instant,
	activeBefore?: ReadonlySet<string>,
) {
	const checks = await tx
		.select({
			id: drivingLicenceCheck.id,
			controlledAt: drivingLicenceCheck.controlledAt,
		})
		.from(drivingLicenceCheck)
		.where(eq(drivingLicenceCheck.organizationId, organizationId));
	const rows = await tx
		.select()
		.from(drivingAuthorization)
		.where(eq(drivingAuthorization.organizationId, organizationId));
	const subjects = await tx
		.select()
		.from(drivingLicenceSubject)
		.where(eq(drivingLicenceSubject.organizationId, organizationId));
	const previous = await tx
		.select()
		.from(drivingLicenceRetention)
		.where(eq(drivingLicenceRetention.organizationId, organizationId));
	// The same authoritative due-departure predicate as access; preserve the exact effective cutoff even before the worker.
	const departures = await tx.execute<{
		employee_id: string;
		employment_period_id: string | null;
		cutoff_at: string | Date;
	}>(
		sql`SELECT employee_id, employment_period_id, cutoff_at FROM employee_departure d WHERE d.organization_id=${organizationId} AND d.cutoff_at<=${dateFromInstant(now)} AND (d.status='effective' OR (d.status='pending' AND employee_departure_denies_access(d.organization_id,d.employee_id,${dateFromInstant(now)})))`,
	);
	const active = new Set<string>();
	const rowsByCheck = new Map<string, typeof rows>();
	for (const row of rows) {
		if (!row.supportingCheckId) continue;
		const group = rowsByCheck.get(row.supportingCheckId) ?? [];
		group.push(row);
		rowsByCheck.set(row.supportingCheckId, group);
	}
	const subjectByPeriod = new Map(
		subjects.map((s) => [`${s.employeeId}:${s.employmentPeriodId}`, s]),
	);
	const departureByPeriod = new Map(
		departures.rows.map((d) => [
			`${d.employee_id}:${d.employment_period_id}`,
			d,
		]),
	);
	const previousByCheck = new Map(previous.map((r) => [r.checkId, r]));
	const changes: Array<typeof drivingLicenceRetention.$inferInsert> = [];
	for (const check of checks) {
		const supporting = rowsByCheck.get(check.id) ?? [];
		const ends = supporting.map((row) => {
			const key = `${row.employeeId}:${row.employmentPeriodId}`;
			const subject = subjectByPeriod.get(key);
			const departure = departureByPeriod.get(key);
			const limits = [
				instantFromDate(row.expiresAt),
				...(row.suspendedAt ? [instantFromDate(row.suspendedAt)] : []),
				...(subject ? [instantFromDate(subject.suspendedAt)] : []),
				...(departure ? [instantFromDate(new Date(departure.cutoff_at))] : []),
			];
			const end = limits.reduce((a, b) =>
				a.epochNanoseconds < b.epochNanoseconds ? a : b,
			);
			if (
				row.state === "active" &&
				!subject &&
				!departure &&
				end.epochNanoseconds > now.epochNanoseconds
			) {
				active.add(check.id);
				return null;
			}
			return end.epochNanoseconds > now.epochNanoseconds ? now : end;
		});
		const saved = previousByCheck.get(check.id);
		let started: Date | null = null;
		if (!active.has(check.id)) {
			if (activeBefore?.has(check.id)) started = dateFromInstant(now);
			else if (saved?.retentionStartedAt) started = saved.retentionStartedAt;
			else {
				const latest = ends
					.filter((v): v is Instant => v !== null)
					.reduce(
						(a, b) => (a.epochNanoseconds > b.epochNanoseconds ? a : b),
						instantFromDate(check.controlledAt),
					);
				started = dateFromInstant(latest);
			}
		}
		if (
			!saved ||
			saved.retentionStartedAt?.toISOString() !== started?.toISOString()
		)
			changes.push({
				organizationId,
				checkId: check.id,
				retentionStartedAt: started,
			});
	}
	// One connection per transaction; batch changed metadata instead of one query per retained check.
	if (changes.length)
		await tx
			.insert(drivingLicenceRetention)
			.values(changes)
			.onConflictDoUpdate({
				target: [
					drivingLicenceRetention.organizationId,
					drivingLicenceRetention.checkId,
				],
				set: { retentionStartedAt: sql`excluded.retention_started_at` },
			});

	return active;
}
