import { type SQL, sql } from "drizzle-orm";
import { db } from "@/db";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import {
	type Clock,
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import {
	onComplianceExceptionApproved,
	onComplianceExceptionRejected,
} from "@/lib/notifications/compliance-triggers";
import { decodeApprovalDatabaseTimestamptz } from "../approval-database-row";
import { isOwnRequestDecision, ownRequestDecisionError } from "../policies/self-decision";
import { periodSubmissionHours } from "../presentation/period-submission-review";
import { resultRows } from "./canonical-inbox-query";
import type {
	CanonicalInboxListFilters,
	CanonicalInboxLoadInput,
	CanonicalInboxReadDatabase,
} from "./canonical-inbox-read";
import { getAgeDays } from "./serialization";
import type {
	ApprovalInboxCapabilities,
	ApprovalInboxDecisionSuccess,
	ApprovalInboxDetailResult,
	ApprovalInboxDetailSection,
	ApprovalInboxItem,
	ApprovalInboxLocalizedText,
	ApprovalInboxPriority,
	ApprovalInboxRiskLevel,
	ApprovalInboxStatus,
	ApprovalInboxTriage,
} from "./types";

/**
 * The Approval inbox adapter of ArbZG compliance exceptions (#1977, Approvals ADR-0005): it
 * lists, counts, opens and decides `compliance_exception` rows directly, with no
 * `approval_request` or canonical workflow behind them.
 *
 * Who sees and decides them is the exception's own rule, not an approver assignment: with
 * `manage Compliance` every exception of the organization, otherwise those of the employees
 * the viewer manages. Nobody decides their own exception, each one is decided on its own
 * (no bulk approve, no fast lane), covering deputies never act on them, and a rejection
 * needs a reason. A pending exception whose 24-hour validity window has passed is expired:
 * it is neither listed, counted nor decidable.
 */

export type ComplianceExceptionInboxScope =
	| { kind: "organization" }
	| { kind: "managed"; employeeIds: readonly string[] };

type ComplianceExceptionType =
	| "rest_period"
	| "overtime_daily"
	| "overtime_weekly"
	| "overtime_monthly";

export interface ComplianceExceptionInboxCountInput {
	organizationId: string;
	scope: ComplianceExceptionInboxScope;
	filters?: CanonicalInboxListFilters;
	/** The instant validity windows are judged at; the system clock's by default. */
	now?: Instant;
	database?: CanonicalInboxReadDatabase;
}

export interface ComplianceExceptionInboxLoadInput extends ComplianceExceptionInboxCountInput {
	status: ApprovalInboxStatus;
	/** The most rows to return; the read service asks for one more than a page. */
	limit?: number;
	cursor?: CanonicalInboxLoadInput["cursor"];
	/** One exception, for the detail view and decisions. */
	exceptionId?: string;
}

/** A page of exceptions; `totalCount` is every match before the limit. */
export type ComplianceExceptionInboxBatch = ApprovalInboxItem[] & { totalCount: number };

/** The adapter as the read service runs it. */
export interface ComplianceExceptionInboxRead {
	load(input: ComplianceExceptionInboxLoadInput): Promise<ComplianceExceptionInboxBatch>;
	/** Pending, unexpired exceptions in the scope. */
	count(input: ComplianceExceptionInboxCountInput): Promise<number>;
}

/**
 * Every compliance exception sorts as one risk/priority band, so the inbox order within the
 * type is submission time; the cursor only needs to compare inside that band.
 */
const RISK_LEVEL: ApprovalInboxRiskLevel = "medium";
const PRIORITY: ApprovalInboxPriority = "high";
const RISK_RANK: Record<ApprovalInboxRiskLevel, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_RANK: Record<ApprovalInboxPriority, number> = {
	urgent: 0,
	high: 1,
	normal: 2,
	low: 3,
};

const EXCEPTION_TYPE_TEXT: Record<ComplianceExceptionType, ApprovalInboxLocalizedText> = {
	rest_period: {
		key: "approvals:approvals.complianceException.types.rest_period",
		fallback: "Rest Period",
	},
	overtime_daily: {
		key: "approvals:approvals.complianceException.types.overtime_daily",
		fallback: "Daily Overtime",
	},
	overtime_weekly: {
		key: "approvals:approvals.complianceException.types.overtime_weekly",
		fallback: "Weekly Overtime",
	},
	overtime_monthly: {
		key: "approvals:approvals.complianceException.types.overtime_monthly",
		fallback: "Monthly Overtime",
	},
};

const EXCEPTION_TYPE_ENGLISH: Record<ComplianceExceptionType, string> = {
	rest_period: "Rest Period",
	overtime_daily: "Daily Overtime",
	overtime_weekly: "Weekly Overtime",
	overtime_monthly: "Monthly Overtime",
};

function readDatabase(input: {
	database?: CanonicalInboxReadDatabase;
}): CanonicalInboxReadDatabase {
	return input.database ?? (db as unknown as CanonicalInboxReadDatabase);
}

function scopeCondition(scope: ComplianceExceptionInboxScope): SQL {
	if (scope.kind === "organization") return sql`true`;
	if (scope.employeeIds.length === 0) return sql`false`;
	return sql`exception.employee_id in (${sql.join(
		scope.employeeIds.map((id) => sql`${id}::uuid`),
		sql`, `,
	)})`;
}

/**
 * An inbox status as rows: pending ones only while their validity window is open; `listable`
 * is any of the three, for opening one exception.
 */
function statusCondition(status: ApprovalInboxStatus | "listable", at: Date): SQL {
	switch (status) {
		case "listable":
			return sql`(${statusCondition("pending", at)} or ${statusCondition("approved", at)}
				or ${statusCondition("rejected", at)})`;
		case "pending":
			return sql`exception.status = 'pending' and exception.valid_until > ${at}::timestamptz`;
		case "approved":
			return sql`exception.status in ('approved', 'used')`;
		case "rejected":
			return sql`exception.status = 'rejected'`;
	}
}

/** `at` is the judging instant as a query parameter: the database boundary. */
function filterConditions(filters: CanonicalInboxListFilters | undefined, at: Date): SQL {
	if (!filters) return sql``;
	const conditions: SQL[] = [];
	if (filters.teamId) conditions.push(sql`requester.team_id = ${filters.teamId}::uuid`);
	if (filters.priority && filters.priority !== PRIORITY) conditions.push(sql`false`);
	if (filters.minAgeDays) {
		conditions.push(
			sql`exception.created_at <= ${at}::timestamptz - ${filters.minAgeDays} * interval '1 day'`,
		);
	}
	if (filters.dateRange) {
		conditions.push(
			sql`exception.created_at >= ${filters.dateRange.from}`,
			sql`exception.created_at <= ${filters.dateRange.to}`,
		);
	}
	if (filters.search) {
		conditions.push(sql`(
			strpos(lower(requester_user.name), ${filters.search}) > 0
			or strpos(lower(requester_user.email), ${filters.search}) > 0
			or strpos(lower(exception.reason), ${filters.search}) > 0
		)`);
	}
	return conditions.length > 0 ? sql`and ${sql.join(conditions, sql` and `)}` : sql``;
}

/** The rows after the cursor: all of them, those later in the band, or none. */
function cursorCondition(cursor: ComplianceExceptionInboxLoadInput["cursor"]): SQL {
	if (!cursor) return sql``;
	const band =
		RISK_RANK[cursor.riskLevel] - RISK_RANK[RISK_LEVEL] ||
		PRIORITY_RANK[cursor.priority] - PRIORITY_RANK[PRIORITY];
	if (band < 0) return sql``;
	if (band > 0) return sql`and false`;
	const createdAt = dateFromInstant(parseInstant(cursor.createdAt));
	return sql`and (exception.created_at > ${createdAt}
		or (exception.created_at = ${createdAt} and exception.id > ${cursor.id}::uuid))`;
}

function candidateQuery(
	input: Omit<ComplianceExceptionInboxLoadInput, "status"> & {
		status: ApprovalInboxStatus | "listable";
	},
	now: Instant,
	countOnly: boolean,
): SQL {
	const at = dateFromInstant(now);
	const selection = countOnly
		? sql`count(*)::integer as "totalCount"`
		: sql`
			exception.id as "id", exception.organization_id as "organizationId",
			exception.employee_id as "employeeId", exception.exception_type as "exceptionType",
			exception.status as "status", exception.reason as "reason",
			exception.planned_duration_minutes as "plannedDurationMinutes",
			exception.valid_from as "validFrom", exception.valid_until as "validUntil",
			exception.created_at as "createdAt", exception.approved_at as "approvedAt",
			exception.rejected_at as "rejectedAt", exception.rejection_reason as "rejectionReason",
			requester.team_id as "teamId", requester_user.name as "userName",
			requester_user.email as "userEmail", requester_user.image as "userImage",
			approver_user.name as "approverName",
			count(*) over()::integer as "totalCount"`;
	const limit = input.exceptionId ? 1 : Math.min(Math.max(Math.floor(input.limit ?? 51), 1), 101);
	return sql`
		select ${selection}
		from compliance_exception exception
		join employee requester
			on requester.id = exception.employee_id and requester.organization_id = exception.organization_id
		join "user" requester_user on requester_user.id = requester.user_id
		left join employee approver
			on approver.id = exception.approver_id and approver.organization_id = exception.organization_id
		left join "user" approver_user on approver_user.id = approver.user_id
		where exception.organization_id = ${input.organizationId}
			and ${scopeCondition(input.scope)}
			and ${statusCondition(input.status, at)}
			${input.exceptionId ? sql`and exception.id = ${input.exceptionId}::uuid` : sql``}
			${filterConditions(input.filters, at)}
			${countOnly ? sql`` : cursorCondition(input.cursor)}
		${countOnly ? sql`` : sql`order by exception.created_at, exception.id limit ${limit}`}
	`;
}

function triageOf(): ApprovalInboxTriage {
	return {
		priority: PRIORITY,
		riskLevel: RISK_LEVEL,
		riskReasons: ["needs_review"],
		// Every statutory waiver gets its own deliberate review (ADR-0005).
		fastLaneGroup: null,
		isPayrollRelevant: false,
		explanation: "Needs manual review.",
	};
}

function capabilitiesOf(status: ApprovalInboxStatus): ApprovalInboxCapabilities {
	return {
		canApprove: status === "pending",
		canReject: status === "pending",
		canBulkApprove: false,
		requiresRejectReason: true,
		singleDecisionOnly: true,
	};
}

/**
 * A listed row's inbox status. Only listable rows get here (`statusCondition`): a persisted
 * `expired` row is never listed or opened, so it needs no inbox status.
 */
function inboxStatusOf(status: string): ApprovalInboxStatus {
	return status === "approved" || status === "used"
		? "approved"
		: status === "rejected"
			? "rejected"
			: "pending";
}

/** A row that is no longer pending, as a stale decision names it. */
function closedStatusOf(status: string): "approved" | "rejected" | "expired" {
	return status === "expired" ? "expired" : status === "rejected" ? "rejected" : "approved";
}

function exceptionTypeOf(value: unknown): ComplianceExceptionType {
	return value === "rest_period" || value === "overtime_weekly" || value === "overtime_monthly"
		? value
		: "overtime_daily";
}

function toItem(row: Record<string, unknown>, now: Instant): ApprovalInboxItem {
	const createdAt = decodeApprovalDatabaseTimestamptz(row.createdAt);
	const validFrom = decodeApprovalDatabaseTimestamptz(row.validFrom);
	const validUntil = decodeApprovalDatabaseTimestamptz(row.validUntil);
	const status = inboxStatusOf(String(row.status));
	const exceptionType = exceptionTypeOf(row.exceptionType);
	const reason = String(row.reason ?? "");
	const resolved =
		status === "approved" ? row.approvedAt : status === "rejected" ? row.rejectedAt : null;
	const validity = {
		key: "approvals:approvals.complianceException.validity",
		fallback: "Valid {from} – {until}",
		params: {
			from: { kind: "instant" as const, at: validFrom.toISOString() },
			until: { kind: "instant" as const, at: validUntil.toISOString() },
		},
	};
	return {
		id: String(row.id),
		type: "compliance_exception",
		entityId: String(row.id),
		status,
		requester: {
			id: String(row.employeeId),
			name: String(row.userName),
			email: String(row.userEmail),
			image: typeof row.userImage === "string" ? row.userImage : null,
			teamId: typeof row.teamId === "string" ? row.teamId : null,
		},
		summary: {
			title: `ArbZG exception: ${EXCEPTION_TYPE_ENGLISH[exceptionType]}`,
			subtitle: `Valid ${validFrom.toISOString()} – ${validUntil.toISOString()}`,
			detail: reason,
			badge: null,
			localized: {
				title: {
					key: "approvals:approvals.complianceException.title",
					fallback: "ArbZG exception: {exceptionType}",
					params: { exceptionType: EXCEPTION_TYPE_TEXT[exceptionType] },
				},
				subtitle: validity,
				detail: {
					key: "approvals:approvals.complianceException.summaryReason",
					fallback: "{reason}",
					params: { reason },
				},
			},
		},
		timing: {
			createdAt: createdAt.toISOString(),
			resolvedAt: resolved ? decodeApprovalDatabaseTimestamptz(resolved).toISOString() : null,
			slaDeadline: status === "pending" ? validUntil.toISOString() : null,
			ageDays: getAgeDays({ createdAt, now: dateFromInstant(now) }),
		},
		triage: triageOf(),
		capabilities: capabilitiesOf(status),
	};
}

export async function loadComplianceExceptionInboxItems(
	input: ComplianceExceptionInboxLoadInput,
): Promise<ComplianceExceptionInboxBatch> {
	const now = input.now ?? systemClock.nowInstant();
	const rows = resultRows(await readDatabase(input).execute(candidateQuery(input, now, false)));
	return Object.assign(
		rows.map((row) => toItem(row, now)),
		{ totalCount: typeof rows[0]?.totalCount === "number" ? rows[0].totalCount : 0 },
	);
}

const DETAIL_TEXT = {
	sectionTitle: {
		key: "approvals:approvals.complianceException.sectionTitle",
		fallback: "ArbZG compliance exception",
	},
	employee: { key: "approvals:approvals.complianceException.employee", fallback: "Employee" },
	exceptionType: {
		key: "approvals:approvals.complianceException.exceptionType",
		fallback: "Exception type",
	},
	plannedDuration: {
		key: "approvals:approvals.complianceException.plannedDuration",
		fallback: "Planned duration",
	},
	notSpecified: {
		key: "approvals:approvals.complianceException.notSpecified",
		fallback: "Not specified",
	},
	validFrom: { key: "approvals:approvals.complianceException.validFrom", fallback: "Valid from" },
	validUntil: {
		key: "approvals:approvals.complianceException.validUntil",
		fallback: "Valid until",
	},
	employeeReason: {
		key: "approvals:approvals.complianceException.employeeReason",
		fallback: "Employee reason",
	},
	rejectionReason: {
		key: "approvals:approvals.complianceException.rejectionReason",
		fallback: "Rejection reason",
	},
	timeline: { key: "approvals:approvals.timeline", fallback: "Timeline" },
	requested: { key: "approvals:approvals.complianceException.requested", fallback: "Requested" },
	approved: { key: "approvals:approvals.complianceException.approved", fallback: "Approved" },
	rejected: { key: "approvals:approvals.complianceException.rejected", fallback: "Rejected" },
} satisfies Record<string, ApprovalInboxLocalizedText>;

function toDetail(row: Record<string, unknown>, now: Instant): ApprovalInboxDetailResult {
	const item = toItem(row, now);
	const planned =
		typeof row.plannedDurationMinutes === "number" ? row.plannedDurationMinutes : null;
	const rejectionReason =
		typeof row.rejectionReason === "string" && row.rejectionReason.trim()
			? row.rejectionReason
			: null;
	const sections: ApprovalInboxDetailSection[] = [
		{
			type: "key_value",
			title: DETAIL_TEXT.sectionTitle,
			rows: [
				{ label: DETAIL_TEXT.employee, value: item.requester.name },
				{
					label: DETAIL_TEXT.exceptionType,
					value: EXCEPTION_TYPE_TEXT[exceptionTypeOf(row.exceptionType)],
				},
				{
					label: DETAIL_TEXT.plannedDuration,
					value:
						planned === null
							? DETAIL_TEXT.notSpecified
							: {
									key: "approvals:approvals.complianceException.plannedHours",
									fallback: "{duration} h",
									params: { duration: periodSubmissionHours(planned) },
								},
				},
				{
					label: DETAIL_TEXT.validFrom,
					value: {
						kind: "instant",
						at: decodeApprovalDatabaseTimestamptz(row.validFrom).toISOString(),
					},
				},
				{
					label: DETAIL_TEXT.validUntil,
					value: {
						kind: "instant",
						at: decodeApprovalDatabaseTimestamptz(row.validUntil).toISOString(),
					},
				},
			],
		},
		{ type: "text", title: DETAIL_TEXT.employeeReason, body: String(row.reason ?? "") },
		...(item.status === "rejected" && rejectionReason
			? [{ type: "text" as const, title: DETAIL_TEXT.rejectionReason, body: rejectionReason }]
			: []),
		{
			type: "timeline",
			title: DETAIL_TEXT.timeline,
			events: [
				{
					id: `${item.id}-requested`,
					label: DETAIL_TEXT.requested,
					at: item.timing.createdAt,
					actorName: item.requester.name,
				},
				...(item.status !== "pending" && item.timing.resolvedAt
					? [
							{
								id: `${item.id}-${item.status}`,
								label: item.status === "approved" ? DETAIL_TEXT.approved : DETAIL_TEXT.rejected,
								at: item.timing.resolvedAt,
								actorName: typeof row.approverName === "string" ? row.approverName : null,
							},
						]
					: []),
			],
		},
	];
	return { item, sections, actions: item.capabilities };
}

/**
 * One exception as the detail panel shows it, or null when it is not the viewer's to see:
 * outside their scope, of another organization, or expired.
 */
export async function loadComplianceExceptionInboxDetail(input: {
	organizationId: string;
	scope: ComplianceExceptionInboxScope;
	exceptionId: string;
	now?: Instant;
	database?: CanonicalInboxReadDatabase;
}): Promise<ApprovalInboxDetailResult | null> {
	if (!UUID_PATTERN.test(input.exceptionId)) return null;
	const now = input.now ?? systemClock.nowInstant();
	const rows = resultRows(
		await readDatabase(input).execute(candidateQuery({ ...input, status: "listable" }, now, false)),
	);
	return rows[0] ? toDetail(rows[0], now) : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function countPendingComplianceExceptions(
	input: ComplianceExceptionInboxCountInput,
): Promise<number> {
	const rows = resultRows(
		await readDatabase(input).execute(
			candidateQuery({ ...input, status: "pending" }, input.now ?? systemClock.nowInstant(), true),
		),
	);
	return typeof rows[0]?.totalCount === "number" ? rows[0].totalCount : 0;
}

export interface ComplianceExceptionDecisionNotifications {
	approved: typeof onComplianceExceptionApproved;
	rejected: typeof onComplianceExceptionRejected;
}

const DEFAULT_NOTIFICATIONS: ComplianceExceptionDecisionNotifications = {
	approved: onComplianceExceptionApproved,
	rejected: onComplianceExceptionRejected,
};

function notFound(exceptionId: string): NotFoundError {
	return new NotFoundError({
		message: "Approval not found",
		entityType: "compliance_exception",
		entityId: exceptionId,
	});
}

function stale(status: string): ConflictError {
	return new ConflictError({
		message: `Request is already ${status}`,
		conflictType: "approval_decision",
	});
}

/**
 * Decides one exception from the inbox (#1977): only within the actor's scope, never their own,
 * only while it is pending and its validity window is open, and a rejection only with a reason.
 * The decision is one conditional update, so a concurrent decision or expiry leaves it stale.
 * The employee is notified afterwards, as the earlier compliance queue did.
 */
export async function decideComplianceExceptionFromInbox(input: {
	organizationId: string;
	exceptionId: string;
	actorEmployeeId: string;
	scope: ComplianceExceptionInboxScope;
	action: "approve" | "reject";
	reason?: string;
	/** Judges the validity window and stamps the decision; the system clock by default. */
	clock?: Clock;
	notify?: ComplianceExceptionDecisionNotifications;
	database?: CanonicalInboxReadDatabase;
}): Promise<ApprovalInboxDecisionSuccess> {
	const database = readDatabase(input);
	const now = (input.clock ?? systemClock).nowInstant();
	const at = dateFromInstant(now);
	if (!UUID_PATTERN.test(input.exceptionId)) throw notFound(input.exceptionId);
	const [target] = resultRows(
		await database.execute(sql`
			select exception.id, exception.employee_id as "employeeId", exception.status,
				exception.valid_until as "validUntil", exception.exception_type as "exceptionType",
				requester.user_id as "employeeUserId", requester_user.first_name as "firstName",
				requester_user.last_name as "lastName", requester_user.name as "name",
				requester_user.email as "email"
			from compliance_exception exception
			join employee requester
				on requester.id = exception.employee_id and requester.organization_id = exception.organization_id
			join "user" requester_user on requester_user.id = requester.user_id
			where exception.organization_id = ${input.organizationId}
				and exception.id = ${input.exceptionId}::uuid
				and ${scopeCondition(input.scope)}
		`),
	);
	if (!target) throw notFound(input.exceptionId);
	if (
		isOwnRequestDecision({
			requesterEmployeeId: String(target.employeeId),
			actorEmployeeId: input.actorEmployeeId,
		})
	) {
		throw ownRequestDecisionError({
			actorEmployeeId: input.actorEmployeeId,
			resource: "compliance_exception",
			action: input.action,
			subject: "compliance exception",
		});
	}
	const validUntil = decodeApprovalDatabaseTimestamptz(target.validUntil);
	if (target.status !== "pending") throw stale(closedStatusOf(String(target.status)));
	if (compareInstants(instantFromDate(validUntil), now) <= 0) throw stale("expired");
	const reason = input.reason?.trim();
	if (input.action === "reject" && !reason) {
		throw new ValidationError({ message: "Rejection reason is required", field: "reason" });
	}

	const [actor] = resultRows(
		await database.execute(sql`
			select actor_user.first_name as "firstName", actor_user.last_name as "lastName",
				actor_user.name as "name", actor_user.email as "email"
			from employee actor
			join "user" actor_user on actor_user.id = actor.user_id
			where actor.id = ${input.actorEmployeeId}::uuid and actor.organization_id = ${input.organizationId}
		`),
	);
	if (!actor) throw notFound(input.exceptionId);

	const decided = resultRows(
		await database.execute(sql`
			update compliance_exception
			set status = ${input.action === "approve" ? "approved" : "rejected"},
				approver_id = ${input.actorEmployeeId}::uuid,
				${
					input.action === "approve"
						? sql`approved_at = ${at}::timestamptz`
						: sql`rejected_at = ${at}::timestamptz, rejection_reason = ${reason}`
				},
				updated_at = ${at}::timestamptz
			where organization_id = ${input.organizationId}
				and id = ${input.exceptionId}::uuid
				and employee_id <> ${input.actorEmployeeId}::uuid
				and status = 'pending'
				and valid_until > ${at}::timestamptz
			returning id
		`),
	);
	if (decided.length === 0) throw stale("decided");

	const notify = input.notify ?? DEFAULT_NOTIFICATIONS;
	const notification = {
		exceptionId: input.exceptionId,
		employeeUserId: String(target.employeeUserId),
		employeeName: buildAuthUserDisplayName(userNameOf(target)),
		organizationId: input.organizationId,
		exceptionType: String(target.exceptionType),
		approverName: buildAuthUserDisplayName(userNameOf(actor)),
	};
	// Fire-and-forget like every compliance notification: the decision stands either way.
	void (input.action === "approve"
		? notify.approved({ ...notification, validUntil })
		: notify.rejected({ ...notification, reason }));

	return {
		id: input.exceptionId,
		type: "compliance_exception",
		status: input.action === "approve" ? "approved" : "rejected",
	};
}

function userNameOf(row: Record<string, unknown>) {
	const text = (value: unknown) => (typeof value === "string" ? value : null);
	return {
		firstName: text(row.firstName),
		lastName: text(row.lastName),
		name: text(row.name) ?? "",
		email: text(row.email),
	};
}

/** A compliance exception as an inbox route's decision logs name it. */
export interface ComplianceExceptionDecisionTarget {
	entityType: "compliance_exception";
	targetType: "compliance_exception";
	status: string;
	workflowKind: null;
}

/**
 * The organization's compliance exception this inbox item id names, whatever its status, or
 * null for any other id. It says nothing about who may see or decide it.
 */
export async function findComplianceExceptionDecisionTarget(input: {
	organizationId: string;
	id: string;
	database?: CanonicalInboxReadDatabase;
}): Promise<ComplianceExceptionDecisionTarget | null> {
	if (!UUID_PATTERN.test(input.id)) return null;
	const [row] = resultRows(
		await readDatabase(input).execute(sql`
			select status from compliance_exception
			where organization_id = ${input.organizationId} and id = ${input.id}::uuid
		`),
	);
	return row
		? {
				entityType: "compliance_exception",
				targetType: "compliance_exception",
				status: String(row.status),
				workflowKind: null,
			}
		: null;
}

/**
 * An inbox route's decision of one compliance exception: within the actor's own scope, which
 * `manage Compliance` widens to the organization.
 */
export async function decideComplianceExceptionForActor(input: {
	organizationId: string;
	exceptionId: string;
	actorEmployeeId: string;
	canManageCompliance: boolean;
	action: "approve" | "reject";
	reason?: string;
}): Promise<ApprovalInboxDecisionSuccess> {
	const scope = await resolveComplianceExceptionInboxScope({
		organizationId: input.organizationId,
		employeeId: input.actorEmployeeId,
		canManageCompliance: input.canManageCompliance,
	});
	if (!scope) throw notFound(input.exceptionId);
	return decideComplianceExceptionFromInbox({
		organizationId: input.organizationId,
		exceptionId: input.exceptionId,
		actorEmployeeId: input.actorEmployeeId,
		scope,
		action: input.action,
		...(input.reason !== undefined ? { reason: input.reason } : {}),
	});
}

/** Which of these ids are compliance exceptions of the organization, whatever their status. */
export async function findComplianceExceptionIds(input: {
	organizationId: string;
	ids: readonly string[];
	database?: CanonicalInboxReadDatabase;
}): Promise<Set<string>> {
	const ids = input.ids.filter((id) => UUID_PATTERN.test(id));
	if (ids.length === 0) return new Set();
	const rows = resultRows(
		await readDatabase(input).execute(sql`
			select id from compliance_exception
			where organization_id = ${input.organizationId}
				and id in (${sql.join(
					ids.map((id) => sql`${id}::uuid`),
					sql`, `,
				)})
		`),
	);
	return new Set(rows.map((row) => String(row.id)));
}

/**
 * Which exceptions the viewer sees and decides: every one of the organization with
 * `manage Compliance`, else those of the employees they manage, else none.
 */
export async function resolveComplianceExceptionInboxScope(input: {
	organizationId: string;
	employeeId: string;
	canManageCompliance: boolean;
	database?: CanonicalInboxReadDatabase;
}): Promise<ComplianceExceptionInboxScope | null> {
	if (input.canManageCompliance) return { kind: "organization" };
	const rows = resultRows(
		await readDatabase(input).execute(sql`
			select managed.id as "employeeId"
			from employee_managers link
			join employee managed
				on managed.id = link.employee_id and managed.organization_id = ${input.organizationId}
			join employee manager
				on manager.id = link.manager_id and manager.organization_id = ${input.organizationId}
			where link.manager_id = ${input.employeeId}::uuid
		`),
	);
	const employeeIds = rows.map((row) => String(row.employeeId));
	return employeeIds.length > 0 ? { kind: "managed", employeeIds } : null;
}

/** Compliance exceptions in the inbox: listed, counted, opened and decided by this adapter. */
export const complianceExceptionInboxRead: ComplianceExceptionInboxRead = {
	load: loadComplianceExceptionInboxItems,
	count: countPendingComplianceExceptions,
};
