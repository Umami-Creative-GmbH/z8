import { sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";
import { departureCutoff } from "./cutoff";
import { type DepartureBlockedReason, evaluateDepartureAuthority } from "./owner-invariant";
import { actorMayResolveDepartureWork } from "./reviews";
import type {
	DeparturePreviewException,
	EmployeeDeparturePreview,
	EmployeeOffboardingState,
	EmployeeOffboardingView,
	OffboardingFollowUpTaskKind,
	OffboardingReviewKind,
} from "./view-types";

type QueryDatabase = Pick<typeof rootDatabase, "execute">;

const MACHINE_REASON = /^[a-z][a-z_]{0,63}$/;

export type DepartureFact = {
	id: string;
	employmentPeriodId: string;
	mode: "scheduled" | "immediate";
	status: "pending" | "canceled" | "blocked" | "effective";
	revision: number;
	lastWorkingDay: string | null;
	cutoffAt: Instant;
	timezone: string;
	replacementEmployeeId: string | null;
	blockedReason: string | null;
	effectiveAt: Instant | null;
	createdAt: Instant;
};

/**
 * The lifecycle state from persisted facts only. A pending departure whose
 * cutoff has passed already denies access, so it reads as offboarded even
 * before a worker materializes it; the view never executes it.
 */
export function deriveOffboardingState(input: {
	employeeActive: boolean;
	openPeriodId: string | null;
	departures: readonly DepartureFact[];
	now: Instant;
}): {
	state: EmployeeOffboardingState;
	departure: DepartureFact | null;
	previousEmploymentPeriodId: string | null;
} {
	const newestFirst = input.departures
		.slice()
		.sort((left, right) => compareInstants(right.createdAt, left.createdAt));
	const pending = newestFirst.find((departure) => departure.status === "pending");
	if (pending) {
		const due = compareInstants(pending.cutoffAt, input.now) <= 0;
		return {
			state: due ? "offboarded" : "scheduled",
			departure: pending,
			previousEmploymentPeriodId: due ? pending.employmentPeriodId : null,
		};
	}
	const blocked = newestFirst.find(
		(departure) =>
			departure.status === "blocked" && departure.employmentPeriodId === input.openPeriodId,
	);
	if (input.openPeriodId && blocked) {
		return { state: "blocked", departure: blocked, previousEmploymentPeriodId: null };
	}
	if (input.openPeriodId || input.employeeActive) {
		return { state: "active", departure: null, previousEmploymentPeriodId: null };
	}
	const effective = input.departures
		.filter((departure) => departure.status === "effective" && departure.effectiveAt)
		.sort((left, right) =>
			compareInstants(right.effectiveAt as Instant, left.effectiveAt as Instant),
		)[0];
	if (effective) {
		return {
			state: "offboarded",
			departure: effective,
			previousEmploymentPeriodId: effective.employmentPeriodId,
		};
	}
	return { state: "legacy_inactive", departure: null, previousEmploymentPeriodId: null };
}

/**
 * Actions offered to the viewer. Every command re-checks authority on the
 * server; these only decide what the UI renders. Managers get a read-only view.
 */
export function deriveOffboardingCapabilities(input: {
	viewer: "admin" | "manager";
	selfTarget: boolean;
	authority: DepartureBlockedReason | null;
	state: EmployeeOffboardingState;
	hasPreviousPeriod: boolean;
	followUp: { failed: number; openReviews: number };
}): EmployeeOffboardingView["capabilities"] {
	const manage =
		input.viewer === "admin" &&
		!input.selfTarget &&
		input.authority !== "initiator_authorization_lost" &&
		input.authority !== "owner_authorization_required";
	const depart = manage && input.authority !== "final_accessible_owner";
	const { state } = input;
	return {
		schedule: depart && (state === "active" || state === "scheduled" || state === "blocked"),
		cancel: manage && (state === "scheduled" || state === "blocked"),
		offboardNow: depart && (state === "active" || state === "scheduled" || state === "blocked"),
		rehire: manage && state === "offboarded" && input.hasPreviousPeriod,
		resolve:
			input.viewer === "admin" && (input.followUp.openReviews > 0 || input.followUp.failed > 0),
	};
}

/** Only an allow-listed machine reason or a UUID reference leaves the server. */
export function publicReviewMetadata(metadata: unknown): {
	reason: string | null;
	handoverTaskId: string | null;
} {
	const record =
		typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
			? (metadata as Record<string, unknown>)
			: {};
	return {
		reason:
			typeof record.reason === "string" && MACHINE_REASON.test(record.reason)
				? record.reason
				: null,
		handoverTaskId: isCanonicalUuid(record.handoverTaskId) ? record.handoverTaskId : null,
	};
}

export type EmployeeOffboardingViewResult =
	| { kind: "ok"; view: EmployeeOffboardingView }
	| { kind: "not_found" }
	| { kind: "forbidden" };

async function resolveViewer(
	database: QueryDatabase,
	input: { organizationId: string; employeeId: string; actorUserId: string; now: Instant },
): Promise<"admin" | "manager" | null> {
	if (
		await actorMayResolveDepartureWork(database, input.organizationId, input.actorUserId, input.now)
	) {
		return "admin";
	}
	const manager = await database.execute(sql`
		SELECT 1 FROM employee_managers link
		JOIN employee manager ON manager.id = link.manager_id
		JOIN employee subject ON subject.id = link.employee_id
		WHERE link.employee_id = ${input.employeeId}::uuid
			AND subject.organization_id = ${input.organizationId}
			AND manager.organization_id = ${input.organizationId}
			AND manager.user_id = ${input.actorUserId} AND manager.is_active = true
		LIMIT 1
	`);
	return manager.rows.length > 0 ? "manager" : null;
}

/**
 * The organization-scoped lifecycle view of one employee: state, the relevant
 * departure with its frozen zone, independent follow-up progress from
 * persisted tasks and reviews, and the viewer's capabilities. Read-only.
 */
export async function getEmployeeOffboardingView(
	database: QueryDatabase,
	input: { organizationId: string; employeeId: string; actorUserId: string; now: Instant },
): Promise<EmployeeOffboardingViewResult> {
	const employees = await database.execute<{
		user_id: string;
		is_active: boolean;
		membership_approved: boolean;
		open_period_id: string | null;
	}>(sql`
		SELECT e.user_id, e.is_active,
			EXISTS (
				SELECT 1 FROM member m
				WHERE m.organization_id = e.organization_id AND m.user_id = e.user_id
					AND m.status = 'approved'
			) AS membership_approved,
			(SELECT p.id FROM employee_employment_period p
				WHERE p.organization_id = e.organization_id AND p.employee_id = e.id
					AND p.status = 'open') AS open_period_id
		FROM employee e
		WHERE e.organization_id = ${input.organizationId} AND e.id = ${input.employeeId}::uuid
	`);
	const target = employees.rows[0];
	if (!target) return { kind: "not_found" };
	const viewer = await resolveViewer(database, input);
	if (!viewer) return { kind: "forbidden" };

	const departures = await database.execute<{
		id: string;
		employment_period_id: string;
		mode: "scheduled" | "immediate";
		status: DepartureFact["status"];
		revision: number;
		last_working_day: string | null;
		cutoff_at: Date;
		timezone: string;
		replacement_employee_id: string | null;
		blocked_reason: string | null;
		effective_at: Date | null;
		created_at: Date;
	}>(sql`
		SELECT id, employment_period_id, mode, status, revision, last_working_day::text AS last_working_day,
			cutoff_at, timezone, replacement_employee_id, blocked_reason, effective_at, created_at
		FROM employee_departure
		WHERE organization_id = ${input.organizationId} AND employee_id = ${input.employeeId}::uuid
			AND status <> 'canceled'
	`);
	const derived = deriveOffboardingState({
		employeeActive: target.is_active,
		openPeriodId: target.open_period_id,
		departures: departures.rows.map((row) => ({
			id: row.id,
			employmentPeriodId: row.employment_period_id,
			mode: row.mode,
			status: row.status,
			revision: Number(row.revision),
			lastWorkingDay: row.last_working_day,
			cutoffAt: instantFromDate(new Date(row.cutoff_at)),
			timezone: row.timezone,
			replacementEmployeeId: row.replacement_employee_id,
			blockedReason: row.blocked_reason,
			effectiveAt: row.effective_at ? instantFromDate(new Date(row.effective_at)) : null,
			createdAt: instantFromDate(new Date(row.created_at)),
		})),
		now: input.now,
	});
	const departure = derived.departure;

	let followUp = { pending: 0, failed: 0, openReviews: 0 };
	let failedTasks: EmployeeOffboardingView["failedTasks"] = [];
	let reviews: EmployeeOffboardingView["reviews"] = [];
	let futureWork = { shifts: 0, absences: 0, employmentTerms: 0 };
	if (departure) {
		const tasks = await database.execute<{ id: string; kind: string; status: string }>(sql`
			SELECT id, kind, status FROM employee_departure_task
			WHERE organization_id = ${input.organizationId} AND departure_id = ${departure.id}::uuid
			ORDER BY created_at, id
		`);
		const reviewRows = await database.execute<{
			id: string;
			kind: OffboardingReviewKind;
			status: "open" | "resolved";
			metadata: unknown;
		}>(sql`
			SELECT id, kind, status, metadata FROM employee_departure_review
			WHERE organization_id = ${input.organizationId} AND departure_id = ${departure.id}::uuid
			ORDER BY created_at, id
		`);
		failedTasks = tasks.rows
			.filter((task) => task.status === "failed")
			.map((task) => ({ id: task.id, kind: task.kind as OffboardingFollowUpTaskKind }));
		reviews = reviewRows.rows.map((review) => ({
			id: review.id,
			kind: review.kind,
			status: review.status,
			...publicReviewMetadata(review.metadata),
			actionUrl: `/settings/employees/${input.employeeId}?review=${review.id}`,
		}));
		followUp = {
			pending: tasks.rows.filter(
				(task) => task.status === "pending" || task.status === "processing",
			).length,
			failed: failedTasks.length,
			openReviews: reviews.filter((review) => review.status === "open").length,
		};
		futureWork = await countFutureWork(database, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			employmentPeriodId: departure.employmentPeriodId,
			cutoff: departure.cutoffAt,
			timezone: departure.timezone,
		});
	}

	const authority = await evaluateDepartureAuthority(database, {
		organizationId: input.organizationId,
		targetUserId: target.user_id,
		initiatorUserId: input.actorUserId,
	});
	return {
		kind: "ok",
		view: {
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			employmentPeriodId: target.open_period_id,
			state: derived.state,
			departure: departure
				? {
						id: departure.id,
						revision: departure.revision,
						mode: departure.mode,
						lastWorkingDay: departure.lastWorkingDay,
						cutoff: departure.cutoffAt.toString(),
						timezone: departure.timezone,
						replacementEmployeeId: departure.replacementEmployeeId,
						blockedReason: departure.blockedReason,
					}
				: null,
			previousEmploymentPeriodId: derived.previousEmploymentPeriodId,
			membershipApproved: target.membership_approved,
			followUp,
			failedTasks,
			reviews,
			futureWork,
			capabilities: deriveOffboardingCapabilities({
				viewer,
				selfTarget: target.user_id === input.actorUserId,
				authority,
				state: derived.state,
				hasPreviousPeriod: derived.previousEmploymentPeriodId !== null,
				followUp,
			}),
		},
	};
}

/**
 * Shifts, absences and confirmed terms dated on or after the cutoff. Dates are
 * compared in the departure's frozen zone. Nothing is deleted here; the UI
 * links to the pages that manage them.
 */
async function countFutureWork(
	database: QueryDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		employmentPeriodId: string;
		cutoff: Instant;
		timezone: string;
	},
) {
	const cutoffDate = input.cutoff.toZonedDateTimeISO(input.timezone).toPlainDate().toString();
	const result = await database.execute<{
		shifts: number;
		absences: number;
		employment_terms: number;
	}>(sql`
		SELECT
			(SELECT count(*)::int FROM shift s
				WHERE s.organization_id = ${input.organizationId} AND s.employee_id = ${input.employeeId}::uuid
					AND s.date::date >= ${cutoffDate}::date) AS shifts,
			(SELECT count(*)::int FROM absence_entry a
				WHERE a.organization_id = ${input.organizationId} AND a.employee_id = ${input.employeeId}::uuid
					AND a.end_date >= ${cutoffDate}::date AND a.status IN ('pending', 'approved')) AS absences,
			(SELECT count(*)::int FROM employee_employment_history h
				WHERE h.organization_id = ${input.organizationId} AND h.employee_id = ${input.employeeId}::uuid
					AND h.employment_period_id = ${input.employmentPeriodId}::uuid
					AND h.review_state = 'confirmed'
					AND h.valid_from >= ${dateFromInstant(input.cutoff)}) AS employment_terms
	`);
	const row = result.rows[0];
	return {
		shifts: Number(row?.shifts ?? 0),
		absences: Number(row?.absences ?? 0),
		employmentTerms: Number(row?.employment_terms ?? 0),
	};
}

export type EmployeeDeparturePreviewResult =
	| { kind: "ok"; preview: EmployeeDeparturePreview }
	| { kind: "not_found" }
	| { kind: "forbidden" }
	| { kind: "invalid"; code: "departure_date_in_past" | "invalid_timezone" };

/**
 * Advisory preview for the departure form: the frozen-zone cutoff, eligible
 * replacement choices and known exceptions. It writes nothing and never
 * executes a pending departure; submission recomputes and revalidates.
 */
export async function previewEmployeeDeparture(
	database: QueryDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		actorUserId: string;
		/** Null previews an immediate departure. */
		lastWorkingDay: string | null;
		/** The replacement being considered; null previews unassigned duties. */
		replacementEmployeeId: string | null;
		now: Instant;
	},
): Promise<EmployeeDeparturePreviewResult> {
	if (
		!(await actorMayResolveDepartureWork(
			database,
			input.organizationId,
			input.actorUserId,
			input.now,
		))
	) {
		return { kind: "forbidden" };
	}
	const targets = await database.execute<{ user_id: string; timezone: string | null }>(sql`
		SELECT e.user_id, o.timezone FROM employee e
		JOIN organization o ON o.id = e.organization_id
		WHERE e.organization_id = ${input.organizationId} AND e.id = ${input.employeeId}::uuid
	`);
	const target = targets.rows[0];
	if (!target) return { kind: "not_found" };
	if (target.user_id === input.actorUserId) return { kind: "forbidden" };

	let cutoff: { lastWorkingDay: string | null; timezone: string; cutoff: Instant };
	if (input.lastWorkingDay === null) {
		cutoff = { lastWorkingDay: null, timezone: target.timezone ?? "UTC", cutoff: input.now };
	} else {
		try {
			cutoff = departureCutoff({
				lastWorkingDay: input.lastWorkingDay,
				timezone: target.timezone,
				now: input.now,
			});
		} catch (error) {
			if (error instanceof Error && error.message === "departure_date_in_past") {
				return { kind: "invalid", code: "departure_date_in_past" };
			}
			if (error instanceof RangeError) return { kind: "invalid", code: "invalid_timezone" };
			throw error;
		}
	}
	const cutoffDate = cutoff.cutoff.toZonedDateTimeISO(cutoff.timezone).toPlainDate().toString();
	const now = dateFromInstant(input.now);

	const facts = await database.execute<{
		canonical_duties: number;
		replacement_requested_duties: number;
		later_stages: number;
		legacy_duties: number;
		running_timer: boolean;
		future_shifts: number;
		future_absences: number;
	}>(sql`
		WITH duties AS (
			SELECT w.requester_employee_id FROM approval_stage_assignment a
			JOIN approval_workflow_stage s ON s.id = a.stage_id AND s.organization_id = a.organization_id
			JOIN approval_workflow w ON w.id = a.workflow_id AND w.organization_id = a.organization_id
			WHERE a.organization_id = ${input.organizationId}
				AND a.approver_employee_id = ${input.employeeId}::uuid AND a.status = 'pending'
				AND w.status = 'pending' AND s.status = 'pending' AND s.activation_mode = 'human'
				AND s.stage_order = w.current_stage_order
		)
		SELECT
			(SELECT count(*)::int FROM duties) AS canonical_duties,
			(SELECT count(*)::int FROM duties
				WHERE requester_employee_id = ${input.replacementEmployeeId}::uuid) AS replacement_requested_duties,
			-- Later stages the capture turns into reviews when there is no replacement.
			(SELECT count(*)::int FROM approval_workflow_stage s
				JOIN approval_workflow w ON w.id = s.workflow_id AND w.organization_id = s.organization_id
				WHERE s.organization_id = ${input.organizationId}
					AND w.status = 'pending' AND s.status = 'waiting'
					AND s.resolver_snapshot->>'approverType' = 'specific_employee'
					AND s.resolver_snapshot->>'approverEmployeeId' = ${input.employeeId}
					AND s.resolver_snapshot->>'fallbackBehavior' = 'fail') AS later_stages,
			(SELECT count(*)::int FROM approval_request r
				WHERE r.organization_id = ${input.organizationId}
					AND r.approver_id = ${input.employeeId}::uuid AND r.status = 'pending'
					AND NOT EXISTS (
						SELECT 1 FROM approval_workflow_stage s
						WHERE s.organization_id = r.organization_id AND s.legacy_approval_request_id = r.id
					)) AS legacy_duties,
			EXISTS (SELECT 1 FROM work_period p
				WHERE p.organization_id = ${input.organizationId} AND p.employee_id = ${input.employeeId}::uuid
					AND p.end_time IS NULL AND p.deleted_at IS NULL) AS running_timer,
			(SELECT count(*)::int FROM shift s
				WHERE s.organization_id = ${input.organizationId} AND s.employee_id = ${input.employeeId}::uuid
					AND s.date::date >= ${cutoffDate}::date) AS future_shifts,
			(SELECT count(*)::int FROM absence_entry a
				WHERE a.organization_id = ${input.organizationId} AND a.employee_id = ${input.employeeId}::uuid
					AND a.end_date >= ${cutoffDate}::date AND a.status IN ('pending', 'approved')) AS future_absences
	`);
	const fact = facts.rows[0];
	const options = await database.execute<{ id: string; name: string | null }>(sql`
		SELECT e.id, u.name FROM employee e
		JOIN member m ON m.user_id = e.user_id AND m.organization_id = e.organization_id
		JOIN "user" u ON u.id = e.user_id
		WHERE e.organization_id = ${input.organizationId} AND e.id <> ${input.employeeId}::uuid
			AND e.is_active = true AND m.status = 'approved' AND e.role IN ('admin', 'manager')
			AND NOT employee_departure_denies_access(e.organization_id, e.id, ${now}::timestamptz)
		ORDER BY u.name, e.id
	`);
	const authority = await evaluateDepartureAuthority(database, {
		organizationId: input.organizationId,
		targetUserId: target.user_id,
		initiatorUserId: input.actorUserId,
	});

	const canonicalDuties = Number(fact?.canonical_duties ?? 0);
	const legacyDuties = Number(fact?.legacy_duties ?? 0);
	// Advisory: the offered set; the handover re-checks each duty's authority.
	const hasReplacement =
		input.replacementEmployeeId !== null &&
		options.rows.some((option) => option.id === input.replacementEmployeeId);
	const exceptions: DeparturePreviewException[] = [];
	if (fact?.running_timer) exceptions.push("running_timer");
	if (Number(fact?.future_shifts ?? 0) > 0) exceptions.push("future_shifts");
	if (Number(fact?.future_absences ?? 0) > 0) exceptions.push("future_absences");
	if (input.replacementEmployeeId !== null && !hasReplacement) {
		exceptions.push("replacement_ineligible");
	}
	if (canonicalDuties > 0 && !hasReplacement) exceptions.push("unassigned_approval_duties");
	if (hasReplacement && Number(fact?.replacement_requested_duties ?? 0) > 0) {
		exceptions.push("replacement_requested_duties");
	}
	if (!hasReplacement && Number(fact?.later_stages ?? 0) > 0) {
		exceptions.push("later_stages_without_replacement");
	}
	if (legacyDuties > 0) exceptions.push("legacy_approval_duties");
	if (authority === "owner_authorization_required" || authority === "final_accessible_owner") {
		exceptions.push(authority);
	}
	return {
		kind: "ok",
		preview: {
			lastWorkingDay: cutoff.lastWorkingDay,
			cutoff: cutoff.cutoff.toString(),
			timezone: cutoff.timezone,
			pendingDutyCount: canonicalDuties + legacyDuties,
			replacementOptions: options.rows.map((row) => ({
				employeeId: row.id,
				name: row.name ?? "",
			})),
			exceptions,
		},
	};
}
