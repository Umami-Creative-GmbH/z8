/**
 * Scoped payroll-ready work collection (#322 / T57), the pure part.
 *
 * Given one repeatable-read snapshot of a scope's work, its historical diagnostics
 * and its departure repairs, this decides what a payroll consumer may credit and
 * what makes the scope uncertain. Every in-scope record is classified **before** any
 * approval, end-present or project filter could drop it:
 *
 * - open work, work whose approval is undecided and approved work with an undecided
 *   correction are blockers, not omissions;
 * - approved work is credited with the shared protected-minute rule (#321) in the
 *   employee-local window, or blocks when its minutes cannot be allocated;
 * - rejected work, the record of a deleted period, valid zero-minute work and work
 *   outside a project filter are excluded, and each exclusion is recorded;
 * - relevant blocking diagnostics (#319) block their scoped employees, widening to
 *   the whole scope when ownership or employees cannot be established.
 *
 * The collected input is immutable: it carries the scope, each work line's source
 * revision and a digest over all of it, so an export can persist it and a recovery
 * can prove it reuses exactly what was collected. A requested export is
 * all-or-blocked; a workspace may show the input with its blockers as incomplete.
 */
import { createHash } from "node:crypto";
import type { InstantRange } from "@/lib/datetime/temporal-boundaries";
import { type Instant, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import {
	allocateProtectedMinutes,
	employeePayrollWindow,
	type ProtectedMinuteBlockReason,
} from "@/lib/payroll-allocation/protected-minutes";
import { canonicalJson } from "@/lib/time-tracking/canonical-json";
import type {
	HistoricalWorkDiagnostics,
	WorkFinding,
} from "@/lib/time-tracking/historical-work-diagnostics";

export const PAYROLL_WORK_INPUT_VERSION = 1;

/** A requested collection: the scope is already resolved to employee IDs. */
export interface PayrollCollectionRequest {
	organizationId: string;
	/** Inclusive calendar dates, interpreted in each employee's zone. */
	startDate: string;
	endDate: string;
	employeeIds: readonly string[];
	/** The filters the employee scope was resolved from, kept as scope evidence. */
	teamIds: readonly string[] | null;
	projectIds: readonly string[] | null;
}

export interface PayrollCollectionEmployee {
	id: string;
	employeeNumber: string | null;
	firstName: string | null;
	lastName: string | null;
	email: string | null;
	/** Effective zone that defines the employee-local payroll window. */
	timezone: string;
}

export interface PayrollCollectionWorkRecord {
	id: string;
	employeeId: string;
	startAt: Instant;
	endAt: Instant | null;
	durationMinutes: number | null;
	approvalState: "draft" | "pending" | "approved" | "rejected";
	updatedAt: Instant;
	/** The legacy period linking the record, if any. */
	workPeriod: { id: string; graphRevision: number; deleted: boolean } | null;
	/** A correction of the record awaits a decision (request or period pending changes). */
	pendingCorrection: boolean;
	workCategory: { id: string; name: string; factor: string | null } | null;
	projects: readonly { projectId: string; name: string; weightPercent: number }[];
}

export interface PayrollCollectionDepartureRepair {
	reviewId: string;
	employeeId: string;
	affectedEndAt: Instant | null;
}

export interface PayrollCollectionSnapshot {
	employees: readonly PayrollCollectionEmployee[];
	/** Work records of the scoped employees that may touch the window, in any state. */
	records: readonly PayrollCollectionWorkRecord[];
	diagnostics: {
		completeness: Pick<HistoricalWorkDiagnostics["completeness"], "status" | "widenedTo">;
		findings: readonly WorkFinding[];
	};
	departureRepairs: readonly PayrollCollectionDepartureRepair[];
}

export type PayrollWorkBlockerKind =
	| "open_work"
	| "pending_work_approval"
	| "pending_work_correction"
	| "unresolved_work_minutes"
	| "uncertain_historical_work"
	| "offboarding_clock_repair";

export interface PayrollWorkBlocker {
	kind: PayrollWorkBlockerKind;
	/**
	 * Record, finding or departure review the blocker comes from. A finding ID can name
	 * work outside the scope, so it stays server-side (logs, operator diagnostics).
	 */
	sourceId: string;
	/** Always one of the scoped employees. */
	employeeId: string;
	/** When the uncertainty starts, if known. */
	at: string | null;
	/** Allocation block reason or diagnostic finding kind. */
	reason: ProtectedMinuteBlockReason | WorkFinding["kind"] | null;
}

export interface CollectedPayrollWork {
	recordId: string;
	employeeId: string;
	/** Identity fields the formatters print, as collected. */
	person: Pick<PayrollCollectionEmployee, "employeeNumber" | "firstName" | "lastName" | "email">;
	/** The credited part of the work: its overlap with the employee-local window. */
	startAt: string;
	endExclusive: string;
	minutes: number;
	workCategory: { id: string; name: string; factor: string | null } | null;
	/** The highest-weighted project allocation. */
	project: { id: string; name: string } | null;
	source: { recordUpdatedAt: string; workPeriodId: string | null; graphRevision: number | null };
}

export type PayrollWorkExclusionReason =
	| "rejected"
	| "deleted"
	| "zero_minutes"
	| "outside_project_filter";

export interface CollectedPayrollWorkInput {
	version: typeof PAYROLL_WORK_INPUT_VERSION;
	organizationId: string;
	scope: {
		employeeIds: string[];
		startDate: string;
		endDate: string;
		teamIds: string[] | null;
		projectIds: string[] | null;
	};
	work: CollectedPayrollWork[];
	/** In-scope work deliberately not credited, with the reason. */
	excluded: { recordId: string; reason: PayrollWorkExclusionReason }[];
	digest: string;
}

export interface PayrollWorkCollection {
	input: CollectedPayrollWorkInput;
	/** Empty exactly when the scope is complete. */
	blockers: PayrollWorkBlocker[];
	/** Effective zone of each scoped employee, for localizing blockers. */
	employeeTimezones: Record<string, string>;
}

export function assessPayrollWorkCollection(
	snapshot: PayrollCollectionSnapshot,
	request: PayrollCollectionRequest,
): PayrollWorkCollection {
	const scope = [...new Set(request.employeeIds)].toSorted();
	const scoped = new Set(scope);
	const employees = new Map(
		snapshot.employees.filter((row) => scoped.has(row.id)).map((row) => [row.id, row]),
	);
	const projectFilter =
		request.projectIds && request.projectIds.length > 0 ? new Set(request.projectIds) : null;

	const work: CollectedPayrollWork[] = [];
	const excluded: CollectedPayrollWorkInput["excluded"] = [];
	const blockers: PayrollWorkBlocker[] = [];

	for (const record of snapshot.records) {
		const owner = employees.get(record.employeeId);
		if (!owner) continue;
		const window = employeePayrollWindow(request.startDate, request.endDate, owner.timezone);
		if (!touchesWindow(record, window)) continue;

		const blocker = (kind: PayrollWorkBlockerKind, reason: PayrollWorkBlocker["reason"] = null) =>
			blockers.push({
				kind,
				sourceId: record.id,
				employeeId: record.employeeId,
				at: instantToCanonicalString(record.startAt),
				reason,
			});

		if (record.approvalState === "rejected") {
			excluded.push({ recordId: record.id, reason: "rejected" });
			continue;
		}
		if (record.workPeriod?.deleted) {
			excluded.push({ recordId: record.id, reason: "deleted" });
			continue;
		}
		if (record.endAt === null) {
			blocker("open_work");
			continue;
		}
		if (record.approvalState !== "approved") {
			blocker("pending_work_approval");
			continue;
		}
		// Approved values that an undecided correction may still change.
		if (record.pendingCorrection) {
			blocker("pending_work_correction");
			continue;
		}

		const allocation = allocateProtectedMinutes(
			{ startAt: record.startAt, endAt: record.endAt, storedMinutes: record.durationMinutes },
			window,
		);
		if (allocation.status === "blocked") {
			blocker("unresolved_work_minutes", allocation.reason);
			continue;
		}
		if (allocation.status === "outside") continue;
		if (projectFilter && !record.projects.some((row) => projectFilter.has(row.projectId))) {
			excluded.push({ recordId: record.id, reason: "outside_project_filter" });
			continue;
		}
		if (allocation.minutes === 0) {
			excluded.push({ recordId: record.id, reason: "zero_minutes" });
			continue;
		}

		const project = record.projects.toSorted(
			(left, right) =>
				right.weightPercent - left.weightPercent || compare(left.projectId, right.projectId),
		)[0];
		work.push({
			recordId: record.id,
			employeeId: record.employeeId,
			person: {
				employeeNumber: owner.employeeNumber,
				firstName: owner.firstName,
				lastName: owner.lastName,
				email: owner.email,
			},
			startAt: instantToCanonicalString(allocation.overlap.start),
			endExclusive: instantToCanonicalString(allocation.overlap.endExclusive),
			minutes: allocation.minutes,
			workCategory: record.workCategory,
			project: project ? { id: project.projectId, name: project.name } : null,
			source: {
				recordUpdatedAt: instantToCanonicalString(record.updatedAt),
				workPeriodId: record.workPeriod?.id ?? null,
				graphRevision: record.workPeriod?.graphRevision ?? null,
			},
		});
	}

	for (const finding of snapshot.diagnostics.findings) {
		if (!(finding.blocking && finding.relevant)) continue;
		const named = finding.employeeIds.filter((employeeId) => scoped.has(employeeId));
		// Unestablished ownership, or evidence naming only others, widens to the scope.
		const affected =
			finding.relevance.level === "organization" || named.length === 0 ? scope : named;
		// When is disclosed only for work entirely within the scope.
		const withinScope = named.length > 0 && named.length === finding.employeeIds.length;
		for (const employeeId of affected) {
			blockers.push({
				kind: "uncertain_historical_work",
				sourceId: finding.id,
				employeeId,
				at: withinScope && finding.relevance.level === "interval" ? finding.relevance.start : null,
				reason: finding.kind,
			});
		}
	}

	for (const repair of snapshot.departureRepairs) {
		if (!scoped.has(repair.employeeId)) continue;
		blockers.push({
			kind: "offboarding_clock_repair",
			sourceId: repair.reviewId,
			employeeId: repair.employeeId,
			at: repair.affectedEndAt ? instantToCanonicalString(repair.affectedEndAt) : null,
			reason: null,
		});
	}

	const unsigned: Omit<CollectedPayrollWorkInput, "digest"> = {
		version: PAYROLL_WORK_INPUT_VERSION,
		organizationId: request.organizationId,
		scope: {
			employeeIds: scope,
			startDate: request.startDate,
			endDate: request.endDate,
			teamIds: request.teamIds ? [...request.teamIds].toSorted() : null,
			projectIds: request.projectIds ? [...request.projectIds].toSorted() : null,
		},
		work: work.toSorted(
			(left, right) =>
				compare(left.employeeId, right.employeeId) ||
				compare(left.startAt, right.startAt) ||
				compare(left.recordId, right.recordId),
		),
		excluded: excluded.toSorted((left, right) => compare(left.recordId, right.recordId)),
	};

	return {
		input: { ...unsigned, digest: payrollWorkInputDigest(unsigned) },
		employeeTimezones: Object.fromEntries(
			[...employees.values()].map((row) => [row.id, row.timezone]),
		),
		blockers: blockers.toSorted(
			(left, right) =>
				compare(left.employeeId, right.employeeId) ||
				compare(left.kind, right.kind) ||
				compare(left.at ?? "", right.at ?? "") ||
				compare(left.sourceId, right.sourceId),
		),
	};
}

/** Digest over every collected fact; the stored digest must match on reuse. */
export function payrollWorkInputDigest(
	input: Omit<CollectedPayrollWorkInput, "digest"> & { digest?: string },
): string {
	const { digest: _digest, ...facts } = input;
	return createHash("sha256").update(canonicalJson(facts)).digest("hex");
}

/**
 * Whether a record may touch the window. Open work is relevant from its start on;
 * reversed endpoints have no established interval, so the hull of both is used.
 */
function touchesWindow(record: PayrollCollectionWorkRecord, window: InstantRange): boolean {
	const start = record.startAt.epochNanoseconds;
	const windowStart = window.start.epochNanoseconds;
	const windowEnd = window.endExclusive.epochNanoseconds;
	if (record.endAt === null) return start < windowEnd;
	const end = record.endAt.epochNanoseconds;
	if (end < start) return end < windowEnd && start >= windowStart;
	if (end === start) return windowStart <= start && start < windowEnd;
	return start < windowEnd && end > windowStart;
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
