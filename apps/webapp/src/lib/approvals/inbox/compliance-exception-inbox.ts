import { inArray, type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { complianceException } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { awaitingComplianceExceptionDecision } from "@/lib/compliance/pending-compliance-exception";
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
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import { decodeApprovalDatabaseTimestamptz } from "../approval-database-row";
import { canOpenApprovalInbox, defineAbilityFor } from "@/lib/authorization/ability";
import {
	loadOrganizationSessionPrincipalContexts,
	type PrincipalLoaderExecutor,
} from "@/lib/authorization/principal-loader";
import type { PrincipalContext } from "@/lib/authorization/types";
import {
	eligibleApprovalScopesOf,
	getEligibleApprovalScopesForManager,
	getEligibleManagerIdsForRequester,
	loadOrganizationApprovalEligibility,
	type OrganizationApprovalEligibility,
} from "../policies/manager-eligibility-db";
import { isOwnRequestDecision, ownRequestDecisionError } from "../policies/self-decision";
import { periodSubmissionHours } from "../presentation/period-submission-review";
import type { ApprovalTriageReason } from "../triage-assessment";
import { requesterEmployeeIdCondition, resultRows } from "./canonical-inbox-query";
import type {
	CanonicalInboxListFilters,
	CanonicalInboxLoadInput,
	CanonicalInboxReadDatabase,
} from "./canonical-inbox-read";
import { localizedTextFallback } from "./localized-text";
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
	ApprovalInboxValue,
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

/**
 * Which compliance exceptions a scope covers: none (no scope, or managing nobody), all of the
 * organization's, or those matching a condition on the exception's employee.
 */
export type ComplianceExceptionScopeCondition =
	| { kind: "none" }
	| { kind: "all" }
	| { kind: "condition"; sql: SQL };

/**
 * A recipient's compliance exception scope as a query condition, the one rule the adapter, the
 * Teams compliance card and the chat digests share. `employeeId` is the column the condition
 * reads: `compliance_exception.employee_id` unless the query aliases the table.
 */
export function complianceExceptionScopeCondition(
	scope: ComplianceExceptionInboxScope | null,
	employeeId: AnyPgColumn = complianceException.employeeId,
): ComplianceExceptionScopeCondition {
	if (!scope) return { kind: "none" };
	if (scope.kind === "organization") return { kind: "all" };
	if (scope.employeeIds.length === 0) return { kind: "none" };
	return { kind: "condition", sql: inArray(employeeId, [...scope.employeeIds]) };
}

/** `compliance_exception` as the hand-written queries below alias it. */
const exceptionAlias = alias(complianceException, "exception");

function scopeCondition(scope: ComplianceExceptionInboxScope): SQL {
	const condition = complianceExceptionScopeCondition(scope, exceptionAlias.employeeId);
	switch (condition.kind) {
		case "none":
			return sql`false`;
		case "all":
			return sql`true`;
		case "condition":
			return condition.sql;
	}
}

/**
 * An inbox status as rows: pending ones only while their validity window is open; `listable`
 * is any of the three, for opening one exception.
 */
function statusCondition(status: ApprovalInboxStatus | "listable", now: Instant): SQL {
	switch (status) {
		case "listable":
			return sql`(${statusCondition("pending", now)} or ${statusCondition("approved", now)}
				or ${statusCondition("rejected", now)})`;
		case "pending":
			return awaitingComplianceExceptionDecision(now, exceptionAlias);
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
	if (filters.requesterEmployeeIds) {
		conditions.push(
			requesterEmployeeIdCondition(sql`exception.employee_id`, filters.requesterEmployeeIds),
		);
	}
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

/**
 * `created_at` at the millisecond an item and its cursor carry. The database stamps it to the
 * microsecond, so comparing or ordering the raw column would put the cursor's own row after the
 * cursor and stall paging.
 */
const CREATED_AT_AS_LISTED = sql`date_trunc('milliseconds', exception.created_at)`;

/** The rows after the cursor: all of them, those later in the band, or none. */
function cursorCondition(cursor: ComplianceExceptionInboxLoadInput["cursor"]): SQL {
	if (!cursor) return sql``;
	const band =
		RISK_RANK[cursor.riskLevel] - RISK_RANK[RISK_LEVEL] ||
		PRIORITY_RANK[cursor.priority] - PRIORITY_RANK[PRIORITY];
	if (band < 0) return sql``;
	if (band > 0) return sql`and false`;
	const createdAt = dateFromInstant(parseInstant(cursor.createdAt));
	return sql`and (${CREATED_AT_AS_LISTED} > ${createdAt}
		or (${CREATED_AT_AS_LISTED} = ${createdAt} and exception.id > ${cursor.id}::uuid))`;
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
			approver_user.name as "approverName", organization.timezone as "organizationTimeZone",
			count(*) over()::integer as "totalCount"`;
	const limit = input.exceptionId ? 1 : Math.min(Math.max(Math.floor(input.limit ?? 51), 1), 101);
	return sql`
		select ${selection}
		from compliance_exception exception
		join organization on organization.id = exception.organization_id
		join employee requester
			on requester.id = exception.employee_id and requester.organization_id = exception.organization_id
		join "user" requester_user on requester_user.id = requester.user_id
		left join employee approver
			on approver.id = exception.approver_id and approver.organization_id = exception.organization_id
		left join "user" approver_user on approver_user.id = approver.user_id
		where exception.organization_id = ${input.organizationId}
			and ${scopeCondition(input.scope)}
			and ${statusCondition(input.status, now)}
			${input.exceptionId ? sql`and exception.id = ${input.exceptionId}::uuid` : sql``}
			${filterConditions(input.filters, at)}
			${countOnly ? sql`` : cursorCondition(input.cursor)}
		${countOnly ? sql`` : sql`order by ${CREATED_AT_AS_LISTED}, exception.id limit ${limit}`}
	`;
}

/** The triage reason every exception carries, in the reader's language like any other item's. */
const NEEDS_REVIEW_REASON = {
	code: "needs_review",
	riskLevel: RISK_LEVEL,
	text: { key: "approvals:triage.reasons.needs_review", fallback: "Needs manual review." },
} as const satisfies ApprovalTriageReason;

function triageOf(): ApprovalInboxTriage {
	return {
		priority: PRIORITY,
		riskLevel: RISK_LEVEL,
		riskReasons: [NEEDS_REVIEW_REASON.code],
		reasons: [NEEDS_REVIEW_REASON],
		// Every statutory waiver gets its own deliberate review (ADR-0005).
		fastLaneGroup: null,
		isPayrollRelevant: false,
		explanation: NEEDS_REVIEW_REASON.text.fallback,
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

/**
 * One end of the validity window, shown in the organization's zone with its label: the rules
 * the exception waives are the organization's, so neither UTC nor the viewer's zone. Every row
 * of a query carries the zone, read with it in the same statement.
 */
function validityInstant(value: unknown, row: Record<string, unknown>): ApprovalInboxValue {
	return {
		kind: "zoned_instant",
		at: decodeApprovalDatabaseTimestamptz(value).toISOString(),
		timeZone: resolveOrganizationTimezone(row.organizationTimeZone ?? undefined).timezone,
	};
}

function toItem(row: Record<string, unknown>, now: Instant): ApprovalInboxItem {
	const createdAt = decodeApprovalDatabaseTimestamptz(row.createdAt);
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
			from: validityInstant(row.validFrom, row),
			until: validityInstant(row.validUntil, row),
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
			subtitle: localizedTextFallback(validity),
			detail: reason,
			badge: null,
			localized: {
				title: {
					key: "approvals:approvals.complianceException.title",
					fallback: "ArbZG exception: {exceptionType}",
					params: { exceptionType: EXCEPTION_TYPE_TEXT[exceptionType] },
				},
				subtitle: validity,
				// The detail is the employee's reason, shown as written: no localized form.
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
				{ label: DETAIL_TEXT.validFrom, value: validityInstant(row.validFrom, row) },
				{ label: DETAIL_TEXT.validUntil, value: validityInstant(row.validUntil, row) },
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
 * Why a decision's conditional update matched no row: the exception as it is now, read again,
 * names how it closed (approved, rejected, expired) once the write found it no longer pending,
 * or is not found when it left the actor's scope.
 */
async function lostDecision(input: {
	organizationId: string;
	exceptionId: string;
	at: Instant;
	database: CanonicalInboxReadDatabase;
}): Promise<ConflictError | NotFoundError> {
	const [current] = resultRows(
		await input.database.execute(sql`
			select status, valid_until as "validUntil" from compliance_exception
			where organization_id = ${input.organizationId} and id = ${input.exceptionId}::uuid
		`),
	);
	if (!current) return notFound(input.exceptionId);
	if (current.status !== "pending") return stale(closedStatusOf(String(current.status)));
	const validUntil = instantFromDate(decodeApprovalDatabaseTimestamptz(current.validUntil));
	if (compareInstants(validUntil, input.at) <= 0) return stale("expired");
	// Still pending and open: the actor's scope no longer holds it, answered as an unknown id.
	return notFound(input.exceptionId);
}

/** The database a decision writes through: its scope re-check and update run as one transaction. */
export interface ComplianceExceptionDecisionDatabase extends CanonicalInboxReadDatabase {
	transaction<T>(run: (tx: ComplianceExceptionDecisionTransaction) => Promise<T>): Promise<T>;
}

type ComplianceExceptionDecisionTransaction = CanonicalInboxReadDatabase &
	Parameters<typeof getEligibleManagerIdsForRequester>[0]["db"];

/**
 * The actor's scope again, inside the decision's transaction: the scope was resolved before the
 * write, and a manager link, team or the actor's own role may have changed since. Managing
 * Compliance is the organization; a manager must still be an eligible manager of the exception's
 * employee, as the shared resolver decides for a persisted source (`existing_workflow`). The
 * actor's employee row stays locked until the decision commits, so their role and activity
 * cannot change under it.
 */
async function actorStillDecides(
	tx: ComplianceExceptionDecisionTransaction,
	input: {
		organizationId: string;
		actorEmployeeId: string;
		requesterEmployeeId: string;
		scope: ComplianceExceptionInboxScope;
	},
): Promise<boolean> {
	if (input.scope.kind === "organization") return true;
	await tx.execute(sql`
		select id from employee
		where id = ${input.actorEmployeeId}::uuid and organization_id = ${input.organizationId}
		for share
	`);
	const managerIds = await getEligibleManagerIdsForRequester({
		db: tx,
		requesterEmployeeId: input.requesterEmployeeId,
		organizationId: input.organizationId,
		requesterMode: "existing_workflow",
	});
	return managerIds.includes(input.actorEmployeeId);
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
	database?: ComplianceExceptionDecisionDatabase;
	/**
	 * Test seam: runs inside the decision's transaction, before it re-checks the actor's scope
	 * and before it writes, so a suite can change the actor's row while the decision is in flight.
	 */
	inFlight?: (stage: "rechecking_scope" | "writing") => Promise<void>;
}): Promise<ApprovalInboxDecisionSuccess> {
	const database = input.database ?? (db as unknown as ComplianceExceptionDecisionDatabase);
	const clock = input.clock ?? systemClock;
	const now = clock.nowInstant();
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

	// The decision is judged and stamped at the instant it is written, which may be later than
	// the checks above: the window can close in between.
	const decidedAt = clock.nowInstant();
	const at = dateFromInstant(decidedAt);
	const decided = await database.transaction(async (tx) => {
		// Locked first: a concurrent decision of the same exception waits for this one to commit.
		await tx.execute(sql`
			select id from compliance_exception
			where organization_id = ${input.organizationId} and id = ${input.exceptionId}::uuid
			for update
		`);
		await input.inFlight?.("rechecking_scope");
		const inScope = await actorStillDecides(tx, {
			organizationId: input.organizationId,
			actorEmployeeId: input.actorEmployeeId,
			requesterEmployeeId: String(target.employeeId),
			scope: input.scope,
		});
		if (!inScope) return [];
		await input.inFlight?.("writing");
		return resultRows(
			await tx.execute(sql`
				update compliance_exception exception
				set status = ${input.action === "approve" ? "approved" : "rejected"},
					approver_id = ${input.actorEmployeeId}::uuid,
					${
						input.action === "approve"
							? sql`approved_at = ${at}::timestamptz`
							: sql`rejected_at = ${at}::timestamptz, rejection_reason = ${reason}`
					},
					updated_at = ${at}::timestamptz
				where exception.organization_id = ${input.organizationId}
					and exception.id = ${input.exceptionId}::uuid
					and exception.employee_id = ${String(target.employeeId)}::uuid
					and exception.employee_id <> ${input.actorEmployeeId}::uuid
					and ${awaitingComplianceExceptionDecision(decidedAt, exceptionAlias)}
					and ${scopeCondition(input.scope)}
				returning exception.id
			`),
		);
	});
	if (decided.length === 0) {
		throw await lostDecision({
			organizationId: input.organizationId,
			exceptionId: input.exceptionId,
			at: decidedAt,
			database,
		});
	}

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
	/** Judges the validity window and stamps the decision; the system clock by default. */
	clock?: Clock;
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
		...(input.clock ? { clock: input.clock } : {}),
	});
}

/**
 * Which of these ids are compliance exceptions of the organization within the scope, whatever
 * their status. One outside the scope is left out, as an unknown id is.
 */
export async function findComplianceExceptionIds(input: {
	organizationId: string;
	ids: readonly string[];
	scope: ComplianceExceptionInboxScope;
	database?: CanonicalInboxReadDatabase;
}): Promise<Set<string>> {
	const ids = input.ids.filter((id) => UUID_PATTERN.test(id));
	if (ids.length === 0) return new Set();
	const rows = resultRows(
		await readDatabase(input).execute(sql`
			select exception.id from compliance_exception exception
			where exception.organization_id = ${input.organizationId}
				and ${scopeCondition(input.scope)}
				and exception.id in (${sql.join(
					ids.map((id) => sql`${id}::uuid`),
					sql`, `,
				)})
		`),
	);
	return new Set(rows.map((row) => String(row.id)));
}

/**
 * Which exceptions the viewer sees and decides: every one of the organization with
 * `manage Compliance`, else those of the employees they are an eligible manager of, else none.
 * Eligibility is the one that addresses the "exception requested" notification: direct managers
 * first, else the primary managers of the employee's teams. So the manager it notifies can
 * always open and decide the exception.
 */
export async function resolveComplianceExceptionInboxScope(input: {
	organizationId: string;
	employeeId: string;
	canManageCompliance: boolean;
	/** This employee's eligible manager scopes when the caller already read them; else read here. */
	eligibleApprovalScopes?: readonly { requesterEmployeeId: string }[];
}): Promise<ComplianceExceptionInboxScope | null> {
	if (input.canManageCompliance) return { kind: "organization" };
	const scopes =
		input.eligibleApprovalScopes ??
		(await getEligibleApprovalScopesForManager({
			db,
			managerEmployeeId: input.employeeId,
			organizationId: input.organizationId,
		}));
	const employeeIds = scopes.map((scope) => scope.requesterEmployeeId);
	return employeeIds.length > 0 ? { kind: "managed", employeeIds } : null;
}

/** Each recipient's compliance exception scope, as their Approval inbox resolves it. */
export interface ComplianceExceptionInboxScopes {
	of(recipient: {
		userId: string;
		employeeId: string;
	}): Promise<ComplianceExceptionInboxScope | null>;
}

type ComplianceExceptionScopesDatabase = Parameters<
	typeof loadOrganizationApprovalEligibility
>[0]["db"] &
	PrincipalLoaderExecutor;

/**
 * The compliance exception scopes of many recipients of one organization (#1977), for a digest
 * run: none for a recipient who may not open the Approval inbox (`canOpenApprovalInbox` on the
 * principal a session would give them, platform admins included), else `manage Compliance` is the
 * organization and anyone else the employees they are an eligible manager of. The organization's
 * eligibility and these users' principals are read once, when the first recipient asks, and every
 * recipient's scope is resolved from them.
 */
export function complianceExceptionInboxScopesFor(input: {
	organizationId: string;
	/** Every recipient who may ask; their permissions are read together. */
	userIds: readonly string[];
	database?: ComplianceExceptionScopesDatabase;
}): ComplianceExceptionInboxScopes {
	const database = input.database ?? (db as unknown as ComplianceExceptionScopesDatabase);
	let loaded:
		| Promise<readonly [OrganizationApprovalEligibility, Map<string, PrincipalContext>]>
		| undefined;
	const load = () => {
		// One after another: `database` may be a transaction, which is one connection.
		loaded ??= (async () => {
			const eligibility = await loadOrganizationApprovalEligibility({
				db: database,
				organizationId: input.organizationId,
			});
			const principals = await loadOrganizationSessionPrincipalContexts(database, {
				organizationId: input.organizationId,
				userIds: input.userIds,
			});
			return [eligibility, principals] as const;
		})().catch((error: unknown) => {
			// A failed read is not kept: a later recipient reads again.
			loaded = undefined;
			throw error;
		});
		return loaded;
	};
	return {
		async of(recipient) {
			const [eligibility, principals] = await load();
			const principal = principals.get(recipient.userId);
			if (!principal) return null;
			// A platform admin's principal holds no employee; their every ability ignores its role.
			const employee = principal.isPlatformAdmin
				? {
						id: recipient.employeeId,
						organizationId: input.organizationId,
						role: "employee" as const,
					}
				: principal.employee;
			if (employee?.id !== recipient.employeeId) return null;
			// The inbox's own gate: someone who may not open it sees no exception there.
			const ability = defineAbilityFor(principal);
			if (!canOpenApprovalInbox(ability, employee)) return null;
			return resolveComplianceExceptionInboxScope({
				organizationId: input.organizationId,
				employeeId: recipient.employeeId,
				canManageCompliance: ability.cannot("manage", "Compliance") === false,
				eligibleApprovalScopes: eligibleApprovalScopesOf(eligibility, recipient.employeeId),
			});
		},
	};
}

/** Compliance exceptions in the inbox: listed, counted, opened and decided by this adapter. */
export const complianceExceptionInboxRead: ComplianceExceptionInboxRead = {
	load: loadComplianceExceptionInboxItems,
	count: countPendingComplianceExceptions,
};
