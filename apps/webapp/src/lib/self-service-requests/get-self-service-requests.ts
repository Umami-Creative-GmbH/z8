import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";

import { db } from "@/db";
import {
	absenceEntry,
	approvalRequest,
	approvalWorkflow,
	complianceException,
	travelExpenseClaim,
	travelExpenseDecisionLog,
	travelExpenseReport,
	travelExpenseReportAdjustment,
	travelExpenseReportCycleClosure,
	travelExpenseReportItem,
	workPeriod,
} from "@/db/schema";
import type {
	TravelExpenseReportItemType,
	TravelExpenseReportKind,
} from "@/db/schema/travel-expense";
import { readApprovalAuthoritySnapshot } from "@/lib/approvals/authority";
import { parseRequesterCancellationMarker } from "@/lib/approvals/domain-adapters/time-correction-cancellation-marker";
import {
	normalizeTimeCorrectionOriginalWorkMetadata,
	normalizeTimeCorrectionWorkflowPayload,
} from "@/lib/approvals/domain-adapters/time-correction-contract";
import { classifyPersistedTimeApprovalRequest } from "@/lib/approvals/server/time-approval-classification";
import { mapConcurrently } from "@/lib/async/map-concurrently";
import { instantFromDB } from "@/lib/datetime/drizzle-adapter";
import {
	compareInstants,
	type Instant,
	instantFromDate,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

import { needsFix } from "./needs-fix";
import type {
	ComplianceExceptionKind,
	SelfServiceRequestAction,
	SelfServiceRequestCounts,
	SelfServiceRequestFilters,
	SelfServiceRequestItem,
	SelfServiceRequestResult,
	SelfServiceRequestSourceError,
	SelfServiceRequestSourceType,
	SelfServiceRequestStatus,
} from "./types";

interface GetSelfServiceRequestsInput {
	employeeId: string;
	organizationId: string;
	filters?: SelfServiceRequestFilters;
	now?: Date;
	/** The request sources to read; every source when omitted. */
	sources?: readonly SelfServiceRequestSourceType[];
	/** The organization's time zone when the caller has already read it; read here otherwise. */
	timeZone?: string;
}

type SourceLoadResult =
	| { items: SelfServiceRequestItem[]; sourceErrors: [] }
	| { items: []; sourceErrors: [SelfServiceRequestSourceError] };

interface TimeCorrectionRow {
	id: string;
	entityId: string;
	organizationId: string;
	requestedBy: string;
	status: "pending" | "approved" | "rejected";
	createdAt: Date;
	approvedAt: Date | null;
	rejectionReason: string | null;
	reason: string | null;
	metadata: unknown;
}

interface CanonicalTimeCorrectionRow {
	id: string;
	organizationId: string;
	workflowType: string;
	sourceType: string;
	sourceId: string;
	requesterEmployeeId: string | null;
	status: string;
	contextSnapshot: unknown;
	displaySnapshot: unknown;
	submittedAt: Date;
	completedAt: Date | null;
	cancelledAt: Date | null;
	decisionReason: string | null;
}

interface AbsenceRow {
	id: string;
	employeeId: string;
	organizationId: string;
	status: "pending" | "approved" | "rejected";
	startDate: string;
	endDate: string;
	rejectionReason: string | null;
	approvedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
	category?: { name: string; type: string; color: string | null } | null;
}

interface TravelExpenseRow {
	id: string;
	employeeId: string;
	organizationId: string;
	type: string;
	status: "draft" | "submitted" | "approved" | "rejected";
	tripStart: Date;
	tripEnd: Date;
	destinationCity: string | null;
	destinationCountry: string | null;
	calculatedAmount: string;
	calculatedCurrency: string;
	submittedAt: Date | null;
	decidedAt: Date | null;
	createdAt: Date;
	decisionLogs?: Array<{
		reason: string | null;
		comment: string | null;
		createdAt: Date;
	}>;
}

interface ExpenseReportRow {
	id: string;
	organizationId: string;
	employeeId: string;
	kind: TravelExpenseReportKind;
	status: "draft" | "submitted" | "returned" | "approved" | "rejected";
	tripPurpose: string | null;
	tripStartDate: string | null;
	tripEndDate: string | null;
	submissionCount: number;
	submittedAt: Date | null;
	decidedAt: Date | null;
	createdAt: Date;
}

interface StandaloneExpenseRow {
	organizationId: string;
	reportId: string;
	type: TravelExpenseReportItemType;
	description: string | null;
	mileageRoute: string | null;
}

interface ComplianceExceptionRow {
	id: string;
	organizationId: string;
	employeeId: string;
	exceptionType: ComplianceExceptionKind;
	status: "pending" | "approved" | "rejected" | "expired" | "used";
	plannedDurationMinutes: number | null;
	validFrom: Date;
	validUntil: Date;
	approvedAt: Date | null;
	rejectedAt: Date | null;
	rejectionReason: string | null;
	createdAt: Date;
}

const SOURCE_ERROR_MESSAGES: Record<SelfServiceRequestSourceType, string> = {
	time_correction: "Time correction requests could not be loaded.",
	absence: "Absence requests could not be loaded.",
	travel_expense: "Travel expense requests could not be loaded.",
	travel_expense_report: "Expense reports could not be loaded.",
	compliance_exception: "Compliance exceptions could not be loaded.",
};

const SOURCE_QUERY_LIMIT = 100;
/** `approval_request.entity_type` of a report's submissions (TRAVEL_EXPENSE_REPORT_SOURCE_TYPE). */
const TRAVEL_EXPENSE_REPORT_SOURCE_TYPE = "travel_expense_report";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getSelfServiceRequests(
	input: GetSelfServiceRequestsInput,
): Promise<SelfServiceRequestResult> {
	// Read once: request dates and compliance exception windows are both shown in this zone.
	const organizationTimeZone =
		input.timeZone === undefined
			? loadOrganizationTimezone(db, input.organizationId)
			: Promise.resolve(input.timeZone);
	// Without it, request dates read in UTC; only the exceptions, whose windows need it, fail.
	const timeZone = organizationTimeZone.catch(() => "UTC");
	const loaders: Record<SelfServiceRequestSourceType, () => Promise<SelfServiceRequestItem[]>> = {
		time_correction: () => loadTimeCorrections(input),
		absence: () => loadAbsences(input),
		travel_expense: () => loadTravelExpenses(input),
		travel_expense_report: () => loadExpenseReports(input),
		compliance_exception: () => loadComplianceExceptions(input, organizationTimeZone),
	};
	const sources = input.sources ?? (Object.keys(loaders) as SelfServiceRequestSourceType[]);
	const sourceResults = await Promise.all(
		sources.map((sourceType) => loadSource(sourceType, loaders[sourceType])),
	);

	const allItems = sourceResults.flatMap((result) => result.items);
	const sourceErrors = sourceResults.flatMap((result) => result.sourceErrors);
	const counts = countItems(allItems, input.now ?? new Date());
	const items = applyFilters(allItems, input.filters).sort(compareItems);

	return { items, counts, sourceErrors, timeZone: await timeZone };
}

async function loadSource(
	sourceType: SelfServiceRequestSourceType,
	loader: () => Promise<SelfServiceRequestItem[]>,
): Promise<SourceLoadResult> {
	try {
		return { items: await loader(), sourceErrors: [] };
	} catch {
		return {
			items: [],
			sourceErrors: [{ sourceType, message: SOURCE_ERROR_MESSAGES[sourceType] }],
		};
	}
}

async function loadTimeCorrections(
	input: GetSelfServiceRequestsInput,
): Promise<SelfServiceRequestItem[]> {
	const rollout = await readApprovalAuthoritySnapshot(db, {
		organizationId: input.organizationId,
		workflowType: "time_correction",
	});
	const legacyWorkflowIds = new Set<string>();
	const legacyItems: SelfServiceRequestItem[] = [];
	let offset = 0;
	while (legacyItems.length < SOURCE_QUERY_LIMIT) {
		const rows = (await db.query.approvalRequest.findMany({
			where: and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.requestedBy, input.employeeId),
				eq(approvalRequest.entityType, "time_entry"),
			),
			orderBy: [desc(approvalRequest.createdAt)],
			limit: SOURCE_QUERY_LIMIT,
			offset,
		})) as TimeCorrectionRow[];
		if (rows.length === 0) break;
		const listings = await loadLegacyTimeCorrectionListings(db, input, rows);

		for (const { row, listing } of listings) {
			if (!listing) continue;
			if (listing.workflowId) legacyWorkflowIds.add(listing.workflowId);
			const { status, availableActions } = listing;
			legacyItems.push({
				id: row.id,
				sourceType: "time_correction",
				sourceId: row.entityId,
				organizationId: row.organizationId,
				employeeId: row.requestedBy,
				status,
				submittedAt: row.createdAt,
				resolvedAt: row.approvedAt,
				title: "time_correction",
				subtitle: "time_entry_correction",
				decisionReason: row.rejectionReason,
				availableActions,
				sourceHref: "/time-tracking",
			});
			if (legacyItems.length === SOURCE_QUERY_LIMIT) break;
		}

		offset += rows.length;
		if (rows.length < SOURCE_QUERY_LIMIT) break;
	}

	// Compatibility rows represent current requests. Cancellation removes those
	// rows, so its retained canonical workflow supplies the view-only history.
	if (rollout.authority === "legacy") {
		return legacyItems;
	}

	const canonicalRows = (await db.query.approvalWorkflow.findMany({
		where: and(
			eq(approvalWorkflow.organizationId, input.organizationId),
			eq(approvalWorkflow.requesterEmployeeId, input.employeeId),
			eq(approvalWorkflow.workflowType, "time_correction"),
			eq(approvalWorkflow.sourceType, "time_entry"),
			rollout.compatibilityWriting ? eq(approvalWorkflow.status, "cancelled") : undefined,
		),
		orderBy: [desc(approvalWorkflow.createdAt)],
		limit: SOURCE_QUERY_LIMIT,
	})) as CanonicalTimeCorrectionRow[];

	return [
		...legacyItems,
		...canonicalRows.flatMap((row) =>
			legacyWorkflowIds.has(row.id) ? [] : mapCanonicalTimeCorrection(row, input),
		),
	];
}

/**
 * The work periods, among `workPeriodIds`, with a pending time correction that My Requests lists
 * as pending, where the employee can cancel it. Classified exactly as `getSelfServiceRequests`
 * classifies corrections, so a request it drops (unclassifiable or malformed legacy data, raised
 * by someone else, or a canonical one it cannot show) is not listed. Its newest-requests limit is
 * not applied. Period submission readiness uses it so a blocker promises My Requests only where
 * the request can be found (#1302).
 */
export async function findTimeCorrectionsListedInMyRequests(
	database: SelfServiceDatabase,
	input: { organizationId: string; employeeId: string; workPeriodIds: readonly string[] },
): Promise<Set<string>> {
	const listed = new Set<string>();
	if (input.workPeriodIds.length === 0) return listed;
	const workPeriodIds = [...input.workPeriodIds];
	const rollout = await readApprovalAuthoritySnapshot(database, {
		organizationId: input.organizationId,
		workflowType: "time_correction",
	});
	const rows = (await database.query.approvalRequest.findMany({
		where: and(
			eq(approvalRequest.organizationId, input.organizationId),
			eq(approvalRequest.requestedBy, input.employeeId),
			eq(approvalRequest.entityType, "time_entry"),
			inArray(approvalRequest.entityId, workPeriodIds),
		),
	})) as TimeCorrectionRow[];
	const listings = await loadLegacyTimeCorrectionListings(database, input, rows);
	const legacyWorkflowIds = new Set<string>();
	for (const { row, listing } of listings) {
		if (!listing) continue;
		if (listing.workflowId) legacyWorkflowIds.add(listing.workflowId);
		if (listing.status === "pending") listed.add(row.entityId);
	}
	if (rollout.authority === "legacy" || rollout.compatibilityWriting) {
		return listed;
	}
	const canonicalRows = (await database.query.approvalWorkflow.findMany({
		where: and(
			eq(approvalWorkflow.organizationId, input.organizationId),
			eq(approvalWorkflow.requesterEmployeeId, input.employeeId),
			eq(approvalWorkflow.workflowType, "time_correction"),
			eq(approvalWorkflow.sourceType, "time_entry"),
			eq(approvalWorkflow.status, "pending"),
			inArray(approvalWorkflow.sourceId, workPeriodIds),
		),
	})) as CanonicalTimeCorrectionRow[];
	for (const row of canonicalRows) {
		if (legacyWorkflowIds.has(row.id)) continue;
		const [item] = mapCanonicalTimeCorrection(row, input);
		if (item?.status === "pending") listed.add(row.sourceId);
	}
	return listed;
}

type SelfServiceDatabase = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type LegacyTimeCorrectionPeriod = Pick<
	typeof workPeriod.$inferSelect,
	"clockInId" | "clockOutId" | "pendingChanges"
>;

/**
 * How My Requests lists one legacy correction request: its status and actions, and the canonical
 * workflow it mirrors. Null when My Requests drops it (not a correction, or malformed).
 */
async function listLegacyTimeCorrection(
	database: SelfServiceDatabase,
	row: TimeCorrectionRow,
	period: LegacyTimeCorrectionPeriod | undefined,
): Promise<{
	workflowId: string | null;
	status: SelfServiceRequestStatus;
	availableActions: SelfServiceRequestAction[];
} | null> {
	let metadata: ReturnType<typeof parseLegacyTimeCorrectionMetadata>;
	try {
		metadata = parseLegacyTimeCorrectionMetadata(row);
	} catch {
		return null;
	}
	if (
		(await classifyPersistedTimeApprovalRequest(database, {
			organizationId: row.organizationId,
			request: row,
			period,
		})) !== "time_correction"
	) {
		return null;
	}
	const status: SelfServiceRequestStatus =
		metadata.cancellationState === "requester"
			? "cancelled"
			: metadata.cancellationState === "invalid"
				? "rejected"
				: row.status;
	const availableActions: SelfServiceRequestAction[] =
		metadata.cancellationState === "invalid" ? ["view"] : actionsFor(status, "time_correction");
	return { workflowId: metadata.workflowId, status, availableActions };
}

async function loadLegacyTimeCorrectionListings(
	database: SelfServiceDatabase,
	input: { organizationId: string; employeeId: string },
	rows: TimeCorrectionRow[],
) {
	if (rows.length === 0) return [];
	const periods = await database.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.organizationId, input.organizationId),
			eq(workPeriod.employeeId, input.employeeId),
			inArray(
				workPeriod.id,
				rows.map((row) => row.entityId),
			),
		),
		columns: { id: true, clockInId: true, clockOutId: true, pendingChanges: true },
	});
	const periodsById = new Map(periods.map((period) => [period.id, period]));
	// Limit evidence reads on the pool. A transaction shares one PostgreSQL connection.
	return mapConcurrently(rows, database === db ? 4 : 1, async (row) => ({
		row,
		listing: await listLegacyTimeCorrection(database, row, periodsById.get(row.entityId)),
	}));
}

function parseLegacyTimeCorrectionMetadata(row: TimeCorrectionRow): {
	workflowId: string | null;
	cancellationState: "absent" | "requester" | "invalid";
} {
	const value = row.metadata;
	if (!record(value)) throw new Error();
	const correction = Object.getOwnPropertyDescriptor(value, "timeCorrection");
	if (!correction?.enumerable || !("value" in correction)) throw new Error();
	normalizeTimeCorrectionWorkflowPayload({ timeCorrection: correction.value });

	const workflow = Object.getOwnPropertyDescriptor(value, "workflow");
	let workflowId: string | null = null;
	if (workflow) {
		if (!workflow.enumerable || !("value" in workflow) || !record(workflow.value)) {
			throw new Error();
		}
		if (
			Object.keys(workflow.value).length !== 2 ||
			typeof workflow.value.id !== "string" ||
			workflow.value.organizationId !== row.organizationId
		) {
			throw new Error();
		}
		workflowId = workflow.value.id;
	}

	const marker = Object.getOwnPropertyDescriptor(value, "cancellation");
	if (!marker) return { workflowId, cancellationState: "absent" };
	try {
		if (
			!marker.enumerable ||
			!("value" in marker) ||
			row.status !== "rejected" ||
			row.rejectionReason !== null ||
			!(row.approvedAt instanceof Date)
		) {
			throw new Error();
		}
		const cancellation = parseRequesterCancellationMarker(marker.value);
		if (
			cancellation.organizationId !== row.organizationId ||
			cancellation.requesterEmployeeId !== row.requestedBy ||
			cancellation.workPeriodId !== row.entityId
		) {
			throw new Error();
		}
		parseCanonicalTimeCorrectionContext(value);
		const submission = strictOwnDataRecord(
			Object.getOwnPropertyDescriptor(value, "submission")?.value,
			Object.hasOwn(
				Object.getOwnPropertyDescriptor(value, "submission")?.value ?? {},
				"submissionId",
			)
				? ["key", "submissionId", "resultKind", "originalStatus"]
				: ["key", "resultKind", "originalStatus"],
		);
		if (
			(cancellation.chainInstanceId === null && submission.resultKind !== "default_created") ||
			(cancellation.chainInstanceId !== null && submission.resultKind !== "chain_created")
		) {
			throw new Error();
		}
		const approvedAt = instantFromDB(row.approvedAt);
		if (!approvedAt || compareInstants(parseInstant(cancellation.cancelledAt), approvedAt) !== 0) {
			throw new Error();
		}
		return { workflowId, cancellationState: "requester" };
	} catch {
		return { workflowId, cancellationState: "invalid" };
	}
}

function mapCanonicalTimeCorrection(
	row: CanonicalTimeCorrectionRow,
	input: GetSelfServiceRequestsInput,
): SelfServiceRequestItem[] {
	if (
		row.organizationId !== input.organizationId ||
		row.requesterEmployeeId !== input.employeeId ||
		row.workflowType !== "time_correction" ||
		row.sourceType !== "time_entry" ||
		(row.status !== "pending" &&
			row.status !== "approved" &&
			row.status !== "rejected" &&
			row.status !== "cancelled")
	) {
		return [];
	}

	try {
		const context = row.contextSnapshot;
		if (
			!record(context) ||
			(Object.hasOwn(context, "organizationId") && context.organizationId !== row.organizationId) ||
			(Object.hasOwn(context, "requesterEmployeeId") &&
				context.requesterEmployeeId !== row.requesterEmployeeId) ||
			(Object.hasOwn(context, "workflowType") && context.workflowType !== row.workflowType) ||
			(Object.hasOwn(context, "source") &&
				(!record(context.source) ||
					context.source.id !== row.sourceId ||
					context.source.type !== row.sourceType))
		) {
			throw new Error();
		}
		const correction = parseCanonicalTimeCorrectionContext(row.contextSnapshot);
		const display = parseCanonicalTimeCorrectionDisplay(
			row.displaySnapshot,
			correction,
			row.requesterEmployeeId,
			context.timeCorrectionOriginalWorkMetadata,
		);
		const status = row.status as SelfServiceRequestStatus;
		return [
			{
				id: row.id,
				sourceType: "time_correction",
				sourceId: row.sourceId,
				organizationId: row.organizationId,
				employeeId: row.requesterEmployeeId,
				status,
				submittedAt: row.submittedAt,
				resolvedAt: status === "cancelled" ? row.cancelledAt : row.completedAt,
				title: display.title,
				subtitle: display.subtitle,
				decisionReason: row.decisionReason,
				availableActions: actionsFor(status, "time_correction"),
				sourceHref: "/time-tracking",
			},
		];
	} catch {
		return [];
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
	);
}

function parseCanonicalTimeCorrectionContext(value: unknown) {
	if (!record(value) || !record(value.submission)) throw new Error();
	const correction = normalizeTimeCorrectionWorkflowPayload({
		timeCorrection: value.timeCorrection,
	}).timeCorrection;
	const submission = value.submission;
	const keys = Object.keys(submission);
	const hasSubmissionId = Object.hasOwn(submission, "submissionId");
	if (
		keys.length !== (hasSubmissionId ? 4 : 3) ||
		!keys.every((key) => ["key", "submissionId", "resultKind", "originalStatus"].includes(key)) ||
		typeof submission.key !== "string" ||
		submission.key.length === 0 ||
		(hasSubmissionId &&
			(typeof submission.submissionId !== "string" || !UUID.test(submission.submissionId))) ||
		(submission.resultKind !== "default_created" &&
			submission.resultKind !== "chain_created" &&
			submission.resultKind !== "auto_completed") ||
		(submission.originalStatus !== "pending" && submission.originalStatus !== "approved") ||
		(submission.resultKind === "auto_completed") !== (submission.originalStatus === "approved")
	) {
		throw new Error();
	}
	return correction;
}

function parseCanonicalTimeCorrectionDisplay(
	value: unknown,
	correction: ReturnType<typeof normalizeTimeCorrectionWorkflowPayload>["timeCorrection"],
	requesterEmployeeId: string,
	originalWorkMetadata: unknown,
): { title: string; subtitle: string } {
	const envelope = strictOwnDataRecord(value, ["displayPayload", "searchText"]);
	if (!record(envelope.displayPayload)) throw new Error();
	const namedProjection =
		Object.hasOwn(envelope.displayPayload, "requesterEmployeeId") ||
		Object.hasOwn(envelope.displayPayload, "requesterName");
	const hasWorkMetadata = Object.hasOwn(correction, "workLocationType");
	// Observed legacy workflows use the adapter's named projection; production
	// canonical submissions use the submission owner's endpoint/work projection.
	const payload = strictOwnDataRecord(
		envelope.displayPayload,
		namedProjection
			? ["requesterEmployeeId", "requesterName", "title", "action", "endpoints"]
			: ["title", "action", "endpoints", ...(hasWorkMetadata ? ["workMetadata"] : [])],
	);
	if (namedProjection) {
		if (
			payload.requesterEmployeeId !== requesterEmployeeId ||
			safeDisplayString(payload.requesterName, 200, false).length === 0
		) {
			throw new Error();
		}
	} else if ("workLocationType" in correction) {
		const work = strictOwnDataRecord(payload.workMetadata, ["original", "requested"]);
		const original = normalizeTimeCorrectionOriginalWorkMetadata(
			strictOwnDataRecord(work.original, ["workLocationType", "workCategoryId"]),
		);
		const requested = normalizeTimeCorrectionOriginalWorkMetadata(
			strictOwnDataRecord(work.requested, ["workLocationType", "workCategoryId"]),
		);
		const recorded = normalizeTimeCorrectionOriginalWorkMetadata(originalWorkMetadata);
		if (
			original.workLocationType !== recorded.workLocationType ||
			original.workCategoryId !== recorded.workCategoryId ||
			requested.workLocationType !== correction.workLocationType ||
			requested.workCategoryId !== correction.workCategoryId
		) {
			throw new Error();
		}
	}
	const title = safeDisplayString(payload.title, 100, false);
	safeDisplayString(envelope.searchText, 1000, true);
	const expectedEndpoints = [
		...(correction.clockInCorrectionId ? ["Clock in"] : []),
		...(correction.clockOutCorrectionId ? ["Clock out"] : []),
	];
	if (
		title !== "Time correction" ||
		payload.action !== correction.action ||
		!strictStringArrayEquals(payload.endpoints, expectedEndpoints)
	) {
		throw new Error();
	}
	return {
		title,
		subtitle: `${correction.action} · ${expectedEndpoints.join(", ")}`,
	};
}

function strictOwnDataRecord(
	value: unknown,
	expectedKeys: readonly string[],
): Record<string, unknown> {
	if (!record(value)) throw new Error();
	const keys = Reflect.ownKeys(value);
	const expectedKeySet = new Set(expectedKeys);
	if (
		keys.length !== expectedKeys.length ||
		keys.some((key) => typeof key !== "string" || !expectedKeySet.has(key))
	) {
		throw new Error();
	}
	const result: Record<string, unknown> = {};
	for (const key of expectedKeys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error();
		result[key] = descriptor.value;
	}
	return result;
}

function safeDisplayString(value: unknown, maxLength: number, allowEmpty: boolean): string {
	if (
		typeof value !== "string" ||
		value.length > maxLength ||
		(!allowEmpty && value.trim().length === 0) ||
		[...value].some((character) => {
			const code = character.charCodeAt(0);
			return code <= 31 || code === 127;
		})
	) {
		throw new Error();
	}
	return value;
}

function strictStringArrayEquals(value: unknown, expected: readonly string[]): boolean {
	if (
		!Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Array.prototype ||
		value.length !== expected.length
	) {
		return false;
	}
	const ownKeys = Reflect.ownKeys(value);
	const expectedKeys = [...expected.map((_, index) => String(index)), "length"];
	const expectedKeySet = new Set(expectedKeys);
	if (
		ownKeys.length !== expectedKeys.length ||
		ownKeys.some((key) => typeof key !== "string" || !expectedKeySet.has(key))
	) {
		return false;
	}
	return expected.every((item, index) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		return descriptor?.enumerable && "value" in descriptor && descriptor.value === item;
	});
}

async function loadAbsences(input: GetSelfServiceRequestsInput): Promise<SelfServiceRequestItem[]> {
	const rows = (await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.organizationId, input.organizationId),
			eq(absenceEntry.employeeId, input.employeeId),
		),
		with: { category: true },
		orderBy: [desc(absenceEntry.createdAt)],
		limit: SOURCE_QUERY_LIMIT,
	})) as AbsenceRow[];

	return rows.map((row) => ({
		id: `absence:${row.id}`,
		sourceType: "absence",
		sourceId: row.id,
		organizationId: row.organizationId,
		employeeId: row.employeeId,
		status: row.status,
		submittedAt: row.createdAt,
		resolvedAt: absenceResolvedAt(row),
		title: row.category?.name ?? "absence",
		subtitle: `${row.startDate} to ${row.endDate}`,
		decisionReason: row.rejectionReason,
		availableActions: actionsFor(row.status, "absence"),
		sourceHref: "/absences",
	}));
}

async function loadTravelExpenses(
	input: GetSelfServiceRequestsInput,
): Promise<SelfServiceRequestItem[]> {
	const rows = (await db.query.travelExpenseClaim.findMany({
		where: and(
			eq(travelExpenseClaim.organizationId, input.organizationId),
			eq(travelExpenseClaim.employeeId, input.employeeId),
			ne(travelExpenseClaim.status, "draft"),
		),
		with: {
			decisionLogs: {
				orderBy: [desc(travelExpenseDecisionLog.createdAt)],
				limit: 1,
			},
		},
		orderBy: [desc(travelExpenseClaim.createdAt)],
		limit: SOURCE_QUERY_LIMIT,
	})) as TravelExpenseRow[];

	return rows.flatMap((row) => {
		if (row.status === "draft") return [];

		const status = mapTravelExpenseStatus(row.status);
		const latestDecisionLog = row.decisionLogs?.[0];

		return [
			{
				id: `travel_expense:${row.id}`,
				sourceType: "travel_expense",
				sourceId: row.id,
				organizationId: row.organizationId,
				employeeId: row.employeeId,
				status,
				submittedAt: row.submittedAt ?? row.createdAt,
				resolvedAt: row.decidedAt,
				title: "travel_expense",
				subtitle: travelExpenseSubtitle(row),
				decisionReason: latestDecisionLog?.reason ?? latestDecisionLog?.comment ?? null,
				// An earlier claim is read-only once decided: a rejection is final, never a fix.
				availableActions: ["view"],
				sourceHref: `/travel-expenses/${row.id}`,
			},
		];
	});
}

/**
 * The employee's expense reports once submitted, each named by its trip purpose or its expense's
 * description or route. An adjustment report copies its original's purpose and dates, so it also
 * names the report it adjusts. A returned report waits for the employee's fix and carries the
 * reviewer's return note; a rejected one is final, with the rejection reason. Withdrawal stays on
 * the report page, so no request here offers cancellation.
 */
async function loadExpenseReports(
	input: GetSelfServiceRequestsInput,
): Promise<SelfServiceRequestItem[]> {
	const rows = (
		(await db.query.travelExpenseReport.findMany({
			where: and(
				eq(travelExpenseReport.organizationId, input.organizationId),
				eq(travelExpenseReport.employeeId, input.employeeId),
				ne(travelExpenseReport.status, "draft"),
			),
			orderBy: [desc(travelExpenseReport.createdAt)],
			limit: SOURCE_QUERY_LIMIT,
		})) as ExpenseReportRow[]
	).filter(
		(row) =>
			row.status !== "draft" &&
			row.organizationId === input.organizationId &&
			row.employeeId === input.employeeId,
	);
	const [returnNotes, rejectionReasons, standaloneExpenses, adjustmentLinks] = await Promise.all([
		loadReturnNotes(input.organizationId, rows),
		loadReportRejectionReasons(input.organizationId, rows),
		loadStandaloneExpenses(input.organizationId, rows),
		loadAdjustmentLinks(input.organizationId, rows),
	]);
	const adjustmentOf = await nameAdjustedReports(input, rows, standaloneExpenses, adjustmentLinks);

	return rows.map((row) => {
		const status = mapExpenseReportStatus(row.status);
		const expense = standaloneExpenses.get(row.id);
		const adjusted = adjustmentOf.get(row.id);
		return {
			id: `travel_expense_report:${row.id}`,
			sourceType: "travel_expense_report",
			sourceId: row.id,
			organizationId: row.organizationId,
			employeeId: row.employeeId,
			status,
			submittedAt: row.submittedAt ?? row.createdAt,
			resolvedAt: row.decidedAt,
			title: expenseReportTitle(row, expense),
			subtitle: expenseReportSubtitle(row),
			details: {
				kind: "expense_report",
				reportKind: row.kind,
				itemType: row.kind === "standalone" ? (expense?.type ?? null) : null,
				...(adjusted ? { adjustmentOf: adjusted } : {}),
			},
			decisionReason:
				status === "returned"
					? (returnNotes.get(row.id) ?? null)
					: status === "rejected"
						? (rejectionReasons.get(row.id) ?? null)
						: null,
			availableActions: status === "returned" ? ["fix", "view"] : ["view"],
			sourceHref: `/travel-expenses/reports/${row.id}`,
		};
	});
}

/** A report's name: its trip purpose, or its (only) expense's description or route; "" if none. */
function expenseReportTitle(row: ExpenseReportRow, expense: StandaloneExpenseRow | undefined) {
	return (
		(row.kind === "trip"
			? row.tripPurpose?.trim()
			: expense?.description?.trim() || expense?.mileageRoute?.trim()) || ""
	);
}

/** Which of these reports are adjustment reports (#615), mapped to the report each adjusts. */
async function loadAdjustmentLinks(organizationId: string, rows: ExpenseReportRow[]) {
	const links = new Map<string, string>();
	if (rows.length === 0) return links;
	const adjustments = (await db.query.travelExpenseReportAdjustment.findMany({
		columns: { organizationId: true, reportId: true, originalReportId: true },
		where: and(
			eq(travelExpenseReportAdjustment.organizationId, organizationId),
			inArray(
				travelExpenseReportAdjustment.reportId,
				rows.map((row) => row.id),
			),
		),
	})) as Array<{ organizationId: string; reportId: string; originalReportId: string }>;
	for (const adjustment of adjustments) {
		if (adjustment.organizationId !== organizationId) continue;
		links.set(adjustment.reportId, adjustment.originalReportId);
	}
	return links;
}

/**
 * The report each adjustment adjusts, named as that report is. An original beyond the listed
 * reports is read by id, still only among the employee's own; one that cannot be read, or has no
 * name, is named null.
 */
async function nameAdjustedReports(
	input: GetSelfServiceRequestsInput,
	rows: ExpenseReportRow[],
	standaloneExpenses: Map<string, StandaloneExpenseRow>,
	links: Map<string, string>,
) {
	const adjusted = new Map<string, { reportId: string; title: string | null }>();
	if (links.size === 0) return adjusted;
	const reports = new Map(rows.map((row) => [row.id, row]));
	const expenses = new Map(standaloneExpenses);
	const unlisted = [...new Set(links.values())].filter((id) => !reports.has(id));
	if (unlisted.length > 0) {
		const originals = (
			(await db.query.travelExpenseReport.findMany({
				where: and(
					eq(travelExpenseReport.organizationId, input.organizationId),
					eq(travelExpenseReport.employeeId, input.employeeId),
					inArray(travelExpenseReport.id, unlisted),
				),
			})) as ExpenseReportRow[]
		).filter(
			(row) => row.organizationId === input.organizationId && row.employeeId === input.employeeId,
		);
		for (const original of originals) reports.set(original.id, original);
		for (const [id, expense] of await loadStandaloneExpenses(input.organizationId, originals)) {
			expenses.set(id, expense);
		}
	}
	for (const [reportId, originalReportId] of links) {
		const original = reports.get(originalReportId);
		adjusted.set(reportId, {
			reportId: originalReportId,
			title: original ? expenseReportTitle(original, expenses.get(original.id)) || null : null,
		});
	}
	return adjusted;
}

/** Closures that send a report back to its employee with a reviewer's note. */
const NOTED_CLOSURE_KINDS = ["returned", "reopened"] as const;

/**
 * The reviewer's note on each returned report's current submission cycle: a reviewer returned
 * it, or an approver reopened its approval for correction (both leave the report "returned").
 */
async function loadReturnNotes(organizationId: string, rows: ExpenseReportRow[]) {
	const returned = rows.filter((row) => row.status === "returned");
	const notes = new Map<string, string>();
	if (returned.length === 0) return notes;
	const closures = await db.query.travelExpenseReportCycleClosure.findMany({
		where: and(
			eq(travelExpenseReportCycleClosure.organizationId, organizationId),
			inArray(travelExpenseReportCycleClosure.kind, [...NOTED_CLOSURE_KINDS]),
			inArray(
				travelExpenseReportCycleClosure.reportId,
				returned.map((row) => row.id),
			),
		),
	});
	for (const row of returned) {
		const closure = closures.find(
			(candidate) =>
				candidate.organizationId === organizationId &&
				candidate.reportId === row.id &&
				(NOTED_CLOSURE_KINDS as readonly string[]).includes(candidate.kind) &&
				candidate.submissionCycle === row.submissionCount,
		);
		if (closure?.note) notes.set(row.id, closure.note);
	}
	return notes;
}

/**
 * The reason of the final rejection behind each rejected report. Returning a cycle also marks its
 * approval request rejected, with the return note as its reason; those requests are named by the
 * cycle's closure and skipped, so a final rejection without a reason shows none.
 */
async function loadReportRejectionReasons(organizationId: string, rows: ExpenseReportRow[]) {
	const rejected = rows.filter((row) => row.status === "rejected");
	const reasons = new Map<string, string>();
	if (rejected.length === 0) return reasons;
	const reportIds = rejected.map((row) => row.id);
	const [requests, closures] = await Promise.all([
		db.query.approvalRequest.findMany({
			where: and(
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.entityType, TRAVEL_EXPENSE_REPORT_SOURCE_TYPE),
				eq(approvalRequest.status, "rejected"),
				inArray(approvalRequest.entityId, reportIds),
			),
			orderBy: [desc(approvalRequest.createdAt)],
		}) as Promise<
			Array<{
				id: string;
				organizationId: string;
				entityType: string;
				entityId: string;
				status: string;
				rejectionReason: string | null;
			}>
		>,
		db.query.travelExpenseReportCycleClosure.findMany({
			where: and(
				eq(travelExpenseReportCycleClosure.organizationId, organizationId),
				inArray(travelExpenseReportCycleClosure.reportId, reportIds),
			),
		}),
	]);
	const closedRequestIds = new Set(
		closures
			.filter((closure) => closure.organizationId === organizationId)
			.map((closure) => closure.approvalRequestId),
	);
	const decided = new Set<string>();
	for (const request of requests) {
		if (
			request.organizationId !== organizationId ||
			request.entityType !== TRAVEL_EXPENSE_REPORT_SOURCE_TYPE ||
			request.status !== "rejected" ||
			closedRequestIds.has(request.id) ||
			decided.has(request.entityId)
		) {
			continue;
		}
		decided.add(request.entityId);
		if (request.rejectionReason) reasons.set(request.entityId, request.rejectionReason);
	}
	return reasons;
}

/**
 * The employee's ArbZG compliance exceptions, view-only: they are requested and used from time
 * tracking. A used exception shows as the approval it was; an expired one passed its 24-hour
 * window undecided. The window is shown in the organization's time zone.
 */
async function loadComplianceExceptions(
	input: GetSelfServiceRequestsInput,
	organizationTimeZone: Promise<string>,
): Promise<SelfServiceRequestItem[]> {
	const rows = (
		(await db.query.complianceException.findMany({
			where: and(
				eq(complianceException.organizationId, input.organizationId),
				eq(complianceException.employeeId, input.employeeId),
			),
			orderBy: [desc(complianceException.createdAt)],
			limit: SOURCE_QUERY_LIMIT,
		})) as ComplianceExceptionRow[]
	).filter(
		(row) => row.organizationId === input.organizationId && row.employeeId === input.employeeId,
	);
	if (rows.length === 0) return [];
	const timeZone = await organizationTimeZone;
	const now = instantFromDate(input.now ?? new Date());

	return rows.map((row) => {
		const status = complianceExceptionStatus(row, now);
		return {
			id: `compliance_exception:${row.id}`,
			sourceType: "compliance_exception",
			sourceId: row.id,
			organizationId: row.organizationId,
			employeeId: row.employeeId,
			status,
			submittedAt: row.createdAt,
			resolvedAt:
				status === "approved" ? row.approvedAt : status === "rejected" ? row.rejectedAt : null,
			title: row.exceptionType,
			subtitle: "",
			decisionReason: status === "rejected" ? row.rejectionReason : null,
			availableActions: ["view"],
			sourceHref: "/time-tracking",
			details: {
				kind: "compliance_exception",
				exceptionType: row.exceptionType,
				plannedDurationMinutes: row.plannedDurationMinutes,
				validFrom: row.validFrom,
				validUntil: row.validUntil,
				timeZone,
			},
		};
	});
}

/**
 * A used exception was approved first. A pending one whose window has passed can no longer be
 * decided: it reads as expired even before anything persists that status.
 */
function complianceExceptionStatus(
	row: ComplianceExceptionRow,
	now: Instant,
): SelfServiceRequestStatus {
	if (row.status === "used") return "approved";
	if (row.status === "pending" && compareInstants(instantFromDate(row.validUntil), now) <= 0) {
		return "expired";
	}
	return row.status;
}

function mapExpenseReportStatus(status: ExpenseReportRow["status"]): SelfServiceRequestStatus {
	return status === "submitted" || status === "draft" ? "pending" : status;
}

/**
 * The trip's stored calendar dates ("YYYY-MM-DD to YYYY-MM-DD"), or the one it has, as
 * `formatPlainDateRange` shows them; empty without either or for a standalone report.
 */
function expenseReportSubtitle(row: ExpenseReportRow): string {
	if (row.tripStartDate && row.tripEndDate) return `${row.tripStartDate} to ${row.tripEndDate}`;
	return row.tripStartDate ?? row.tripEndDate ?? "";
}

/** The (only) expense of each standalone report, which names it: its type, description or route. */
async function loadStandaloneExpenses(organizationId: string, rows: ExpenseReportRow[]) {
	const standalone = rows.filter((row) => row.kind === "standalone");
	const expenses = new Map<string, StandaloneExpenseRow>();
	if (standalone.length === 0) return expenses;
	const items = (await db.query.travelExpenseReportItem.findMany({
		columns: {
			organizationId: true,
			reportId: true,
			position: true,
			type: true,
			description: true,
			mileageRoute: true,
		},
		where: and(
			eq(travelExpenseReportItem.organizationId, organizationId),
			inArray(
				travelExpenseReportItem.reportId,
				standalone.map((row) => row.id),
			),
		),
		orderBy: [asc(travelExpenseReportItem.position)],
	})) as StandaloneExpenseRow[];
	for (const item of items) {
		if (item.organizationId !== organizationId || expenses.has(item.reportId)) continue;
		expenses.set(item.reportId, item);
	}
	return expenses;
}

function absenceResolvedAt(row: AbsenceRow): Date | null {
	if (row.status === "approved") {
		return row.approvedAt;
	}

	if (row.status === "rejected") {
		return row.approvedAt ?? row.updatedAt;
	}

	return null;
}

function mapTravelExpenseStatus(status: TravelExpenseRow["status"]): SelfServiceRequestStatus {
	return status === "approved" || status === "rejected" ? status : "pending";
}

function travelExpenseSubtitle(row: TravelExpenseRow): string {
	const destination = [row.destinationCity, row.destinationCountry].filter(Boolean).join(", ");
	const amount = `${row.calculatedAmount} ${row.calculatedCurrency}`;

	return destination ? `${destination} · ${amount}` : amount;
}

function actionsFor(
	status: SelfServiceRequestStatus,
	sourceType?: SelfServiceRequestSourceType,
): SelfServiceRequestAction[] {
	if (status === "rejected") {
		return ["fix", "view"];
	}

	if (status === "pending" && (sourceType === "absence" || sourceType === "time_correction")) {
		return ["cancel", "view"];
	}

	return ["view"];
}

function countItems(items: SelfServiceRequestItem[], now: Date): SelfServiceRequestCounts {
	const recentCutoff = instantFromDate(now)
		.toZonedDateTimeISO("UTC")
		.subtract({ days: 30 })
		.toInstant();

	return {
		pending: items.filter((item) => item.status === "pending").length,
		requiredFixes: items.filter(needsFix).length,
		// A rejection that needs a fix is counted, and shown, as a required fix only.
		recentDecisions: items.filter((item) => {
			if (
				(item.status !== "approved" && item.status !== "rejected") ||
				item.resolvedAt === null ||
				needsFix(item)
			) {
				return false;
			}

			return compareInstants(instantFromDate(item.resolvedAt), recentCutoff) >= 0;
		}).length,
		total: items.length,
	};
}

function applyFilters(
	items: SelfServiceRequestItem[],
	filters: SelfServiceRequestFilters | undefined,
): SelfServiceRequestItem[] {
	const search = filters?.search?.trim().toLowerCase();

	return items.filter((item) => {
		if (filters?.status && filters.status !== "all" && item.status !== filters.status) {
			return false;
		}

		if (
			filters?.sourceType &&
			filters.sourceType !== "all" &&
			item.sourceType !== filters.sourceType
		) {
			return false;
		}

		if (!search) {
			return true;
		}

		return [item.title, item.subtitle, item.decisionReason]
			.filter((value): value is string => Boolean(value))
			.some((value) => value.toLowerCase().includes(search));
	});
}

function compareItems(a: SelfServiceRequestItem, b: SelfServiceRequestItem): number {
	const statusDelta = statusRank(a.status) - statusRank(b.status);

	if (statusDelta !== 0) {
		return statusDelta;
	}

	return relevantDate(b).getTime() - relevantDate(a).getTime();
}

function statusRank(status: SelfServiceRequestStatus): number {
	if (status === "rejected" || status === "returned") {
		return 0;
	}

	if (status === "pending") {
		return 1;
	}

	return 2;
}

function relevantDate(item: SelfServiceRequestItem): Date {
	return item.resolvedAt ?? item.submittedAt;
}
