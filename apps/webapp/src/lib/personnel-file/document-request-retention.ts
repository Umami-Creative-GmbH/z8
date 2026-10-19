import { and, asc, eq, inArray, isNull, max, ne, notExists, or, sql } from "drizzle-orm";
import type { Temporal } from "temporal-polyfill";
import type { db as appDb } from "@/db";
import { organization } from "@/db/auth-schema";
import {
	employee,
	employeeDocumentRequest,
	employeeDocumentRequestDocument,
	employeeDocumentRequestEvent,
} from "@/db/schema";
import { employeeEmploymentPeriod } from "@/db/schema/employee-lifecycle";
import {
	comparePlainDates,
	type Instant,
	instantFromDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import type { UnprocessableAuditRecord } from "./audit";
import {
	DOCUMENT_REQUEST_CATEGORIES,
	type DocumentRequestCategory,
	type DocumentRequestEventKind,
	type DocumentRequestStatus,
} from "./document-request.types";
import {
	deleteDocumentRequestRow,
	minimiseDocumentRequestAudits,
	redactDocumentRequestNotifications,
} from "./document-request-purge";
import { loadOrganizationDay } from "./organization-day";
import { type EmploymentPeriodForRetention, retentionDueDate } from "./retention";
import { loadRetentionPeriods, type RetentionPeriods } from "./retention-store";

/**
 * Automatic deletion of document requests without documents (#1408, spec
 * #1307), such as one cancelled at departure. A request's retention start is
 * that of a document of its category dated the day the request was closed
 * (accepted or cancelled) in the organization's timezone: the end of the later
 * of that year and the year the employment ended. Once the category's
 * retention period has passed since then, the request is deleted without
 * confirmation, with its history, and its free text is removed from its audit
 * records and stored notifications. Open and submitted requests, requests of
 * current employees (no retention start), categories without a retention
 * period and accepted renewals whose renewed document still exists (they keep
 * it renewed) are never deleted here. A request with documents goes only with
 * its last purged document (`purgeDueDocuments`). The deletion writes no audit
 * record: it has no actor, and the audit log needs one.
 */

const logger = createLogger("PersonnelFileDocumentRequestRetention");

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

const CLOSED_STATUSES = [
	"accepted",
	"cancelled",
] as const satisfies readonly DocumentRequestStatus[];

/** The history events that close a request: its retention counts from the last one. */
const CLOSING_EVENT_KINDS = [
	"accepted",
	"cancelled",
] as const satisfies readonly DocumentRequestEventKind[];

export interface DocumentRequestRetentionResult {
	/** False when an organization or a due request failed (logged; retried next run). */
	success: boolean;
	/** Organizations with personnel files on that were checked. */
	organizations: number;
	deleted: number;
	/** Requests that were due but could not be deleted. */
	failed: number;
	/** Organizations whose run failed as a whole. */
	errors: Array<{ organizationId: string; error: string }>;
}

/** The request's audit records cannot be minimised, so it is not deleted. */
export class DocumentRequestRetentionAuditError extends Error {
	constructor(readonly unprocessable: UnprocessableAuditRecord[]) {
		super(
			`Cannot remove the document request's free text from audit records ${unprocessable
				.map((record) => record.auditId)
				.join(", ")}`,
		);
		this.name = "DocumentRequestRetentionAuditError";
	}
}

interface ClosedRequest {
	id: string;
	employeeId: string;
	category: DocumentRequestCategory;
	updatedAt: Date;
}

/** Closed requests of the organization in the given categories that have no document. */
function closedRequestsWithoutDocuments(
	database: Reader,
	input: {
		organizationId: string;
		categories: readonly ClosedRequest["category"][];
		requestId?: string;
	},
) {
	return database
		.select({
			id: employeeDocumentRequest.id,
			employeeId: employeeDocumentRequest.employeeId,
			category: employeeDocumentRequest.category,
			updatedAt: employeeDocumentRequest.updatedAt,
		})
		.from(employeeDocumentRequest)
		.where(
			and(
				eq(employeeDocumentRequest.organizationId, input.organizationId),
				input.requestId ? eq(employeeDocumentRequest.id, input.requestId) : undefined,
				inArray(employeeDocumentRequest.status, [...CLOSED_STATUSES]),
				inArray(employeeDocumentRequest.category, [...input.categories]),
				// An accepted renewal keeps its renewed document renewed while that document exists.
				or(
					ne(employeeDocumentRequest.status, "accepted"),
					isNull(employeeDocumentRequest.renewedDocumentId),
				),
				notExists(
					database
						.select({ one: sql`1` })
						.from(employeeDocumentRequestDocument)
						.where(
							and(
								eq(employeeDocumentRequestDocument.organizationId, input.organizationId),
								eq(employeeDocumentRequestDocument.requestId, employeeDocumentRequest.id),
							),
						),
				),
				// Narrowing only: an open employment period means no retention start.
				notExists(
					database
						.select({ one: sql`1` })
						.from(employeeEmploymentPeriod)
						.where(
							and(
								eq(employeeEmploymentPeriod.organizationId, input.organizationId),
								eq(employeeEmploymentPeriod.employeeId, employeeDocumentRequest.employeeId),
								eq(employeeEmploymentPeriod.status, "open"),
							),
						),
				),
			),
		)
		.orderBy(asc(employeeDocumentRequest.id));
}

async function loadClosingInstants(
	database: Reader,
	input: { organizationId: string; requestIds: readonly string[] },
): Promise<Map<string, Date>> {
	if (input.requestIds.length === 0) return new Map();
	const rows = await database
		.select({
			requestId: employeeDocumentRequestEvent.requestId,
			closedAt: max(employeeDocumentRequestEvent.occurredAt),
		})
		.from(employeeDocumentRequestEvent)
		.where(
			and(
				eq(employeeDocumentRequestEvent.organizationId, input.organizationId),
				inArray(employeeDocumentRequestEvent.requestId, [...input.requestIds]),
				inArray(employeeDocumentRequestEvent.kind, [...CLOSING_EVENT_KINDS]),
			),
		)
		.groupBy(employeeDocumentRequestEvent.requestId);
	const closing = new Map<string, Date>();
	for (const row of rows) if (row.closedAt) closing.set(row.requestId, row.closedAt);
	return closing;
}

async function loadEmploymentPeriods(
	database: Reader,
	input: { organizationId: string; employeeIds: readonly string[] },
): Promise<Map<string, EmploymentPeriodForRetention[]>> {
	const byEmployee = new Map<string, EmploymentPeriodForRetention[]>();
	if (input.employeeIds.length === 0) return byEmployee;
	const rows = await database
		.select({
			employeeId: employeeEmploymentPeriod.employeeId,
			status: employeeEmploymentPeriod.status,
			endedAt: employeeEmploymentPeriod.endedAt,
		})
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, input.organizationId),
				inArray(employeeEmploymentPeriod.employeeId, [...input.employeeIds]),
			),
		);
	for (const row of rows) {
		const list = byEmployee.get(row.employeeId) ?? [];
		list.push({ status: row.status, endedAt: row.endedAt ? instantFromDate(row.endedAt) : null });
		byEmployee.set(row.employeeId, list);
	}
	return byEmployee;
}

interface RetentionContext {
	organizationId: string;
	timezone: string;
	today: Temporal.PlainDate;
	periods: RetentionPeriods;
}

/** The requests among `requests` that are due for deletion today. */
async function dueRequests(
	database: Reader,
	context: RetentionContext,
	requests: readonly ClosedRequest[],
): Promise<ClosedRequest[]> {
	if (requests.length === 0) return [];
	const [closing, employment] = await Promise.all([
		loadClosingInstants(database, {
			organizationId: context.organizationId,
			requestIds: requests.map((request) => request.id),
		}),
		loadEmploymentPeriods(database, {
			organizationId: context.organizationId,
			employeeIds: [...new Set(requests.map((request) => request.employeeId))],
		}),
	]);
	return requests.filter((request) => {
		const retentionYears = context.periods[request.category];
		if (retentionYears === undefined) return false;
		// The closing event; a closed request without one (never written so) counts from its last change.
		const closedAt = instantFromDate(closing.get(request.id) ?? request.updatedAt);
		const dueOn = retentionDueDate({
			periods: employment.get(request.employeeId) ?? [],
			documentDate: plainDateAt(closedAt, context.timezone).toString(),
			timezone: context.timezone,
			retentionYears,
		});
		return dueOn !== null && comparePlainDates(context.today, dueOn) >= 0;
	});
}

/**
 * Deletes one due request in its own transaction, deciding again under the
 * locks: the employee row is held (a rehire reopens the employment), then the
 * request. False when it is no longer due.
 */
async function deleteDueRequest(
	database: Database,
	context: RetentionContext,
	candidate: ClosedRequest,
): Promise<boolean> {
	return database.transaction(async (tx) => {
		const { organizationId } = context;
		await tx
			.select({ id: employee.id })
			.from(employee)
			.where(
				and(eq(employee.organizationId, organizationId), eq(employee.id, candidate.employeeId)),
			)
			.for("share");
		await tx
			.select({ id: employeeDocumentRequest.id })
			.from(employeeDocumentRequest)
			.where(
				and(
					eq(employeeDocumentRequest.organizationId, organizationId),
					eq(employeeDocumentRequest.id, candidate.id),
				),
			)
			.for("update");
		const [current] = await closedRequestsWithoutDocuments(tx, {
			organizationId,
			categories: [candidate.category],
			requestId: candidate.id,
		});
		if (!current) return false;
		const [due] = await dueRequests(tx, context, [current]);
		if (!due) return false;
		const unprocessable = await minimiseDocumentRequestAudits(tx, {
			organizationId,
			requestIds: [due.id],
		});
		if (unprocessable.length > 0) throw new DocumentRequestRetentionAuditError(unprocessable);
		await redactDocumentRequestNotifications(tx, { organizationId, requestIds: [due.id] });
		return deleteDocumentRequestRow(tx, { organizationId, requestId: due.id });
	});
}

async function retainOrganization(
	database: Database,
	organizationId: string,
	now: Instant,
): Promise<{ deleted: number; failed: number }> {
	const periods = await loadRetentionPeriods(database, organizationId);
	const categories = DOCUMENT_REQUEST_CATEGORIES.filter(
		(category) => periods[category] !== undefined,
	);
	if (categories.length === 0) return { deleted: 0, failed: 0 };
	const { timezone, today } = await loadOrganizationDay(database, { organizationId, now });
	const context: RetentionContext = { organizationId, timezone, today, periods };
	const candidates = await closedRequestsWithoutDocuments(database, { organizationId, categories });
	const due = await dueRequests(database, context, candidates);
	const outcome = { deleted: 0, failed: 0 };
	// One request per transaction: a failure never holds back the others.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const request of due) {
		try {
			if (await deleteDueRequest(database, context, request)) outcome.deleted += 1;
		} catch (error) {
			outcome.failed += 1;
			logger.error(
				{ error, organizationId, requestId: request.id },
				"Document request retention deletion failed",
			);
		}
	}
	return outcome;
}

/**
 * Runs the deletion for every organization with personnel files on (or the
 * given ones, still only while on). One organization's failure does not stop
 * the others.
 */
export async function runDocumentRequestRetention(
	database: Database,
	options: { now?: Instant; organizationIds?: readonly string[] } = {},
): Promise<DocumentRequestRetentionResult> {
	const now = options.now ?? systemClock.nowInstant();
	const organizations = await database
		.select({ id: organization.id })
		.from(organization)
		.where(
			and(
				eq(organization.personnelFilesEnabled, true),
				options.organizationIds
					? inArray(organization.id, [...options.organizationIds])
					: undefined,
			),
		);
	const result: DocumentRequestRetentionResult = {
		success: true,
		organizations: 0,
		deleted: 0,
		failed: 0,
		errors: [],
	};
	// One tenant at a time keeps failures isolated.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const { id } of organizations) {
		try {
			const outcome = await retainOrganization(database, id, now);
			result.organizations += 1;
			result.deleted += outcome.deleted;
			result.failed += outcome.failed;
			if (outcome.failed > 0) result.success = false;
		} catch (error) {
			result.success = false;
			result.errors.push({
				organizationId: id,
				error: error instanceof Error ? error.message : String(error),
			});
			logger.error({ error, organizationId: id }, "Document request retention failed");
		}
	}
	return result;
}
