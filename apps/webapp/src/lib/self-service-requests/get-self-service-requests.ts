import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { DateTime } from "luxon";

import { db } from "@/db";
import {
	absenceEntry,
	approvalRequest,
	approvalWorkflow,
	travelExpenseClaim,
	travelExpenseDecisionLog,
	workPeriod,
} from "@/db/schema";
import { readApprovalAuthoritySnapshot } from "@/lib/approvals/authority";
import { parseRequesterCancellationMarker } from "@/lib/approvals/domain-adapters/time-correction-cancellation-marker";
import {
	normalizeTimeCorrectionOriginalWorkMetadata,
	normalizeTimeCorrectionWorkflowPayload,
} from "@/lib/approvals/domain-adapters/time-correction-contract";
import { classifyPersistedTimeApprovalRequest } from "@/lib/approvals/server/time-approval-classification";
import { instantFromDB } from "@/lib/datetime/drizzle-adapter";
import { compareInstants, parseInstant } from "@/lib/datetime/temporal-core";

import type {
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

const SOURCE_ERROR_MESSAGES: Record<SelfServiceRequestSourceType, string> = {
	time_correction: "Time correction requests could not be loaded.",
	absence: "Absence requests could not be loaded.",
	travel_expense: "Travel expense requests could not be loaded.",
};

const SOURCE_QUERY_LIMIT = 100;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getSelfServiceRequests(
	input: GetSelfServiceRequestsInput,
): Promise<SelfServiceRequestResult> {
	const sourceResults = await Promise.all([
		loadSource("time_correction", () => loadTimeCorrections(input)),
		loadSource("absence", () => loadAbsences(input)),
		loadSource("travel_expense", () => loadTravelExpenses(input)),
	]);

	const allItems = sourceResults.flatMap((result) => result.items);
	const sourceErrors = sourceResults.flatMap((result) => result.sourceErrors);
	const counts = countItems(allItems, input.now ?? new Date());
	const items = applyFilters(allItems, input.filters).sort(compareItems);

	return { items, counts, sourceErrors };
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
			sourceErrors: [
				{ sourceType, message: SOURCE_ERROR_MESSAGES[sourceType] },
			],
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
		const periodsById = await loadLegacyTimeCorrectionPeriods(db, input, rows);
		const listings = await Promise.all(
			rows.map(async (row) => ({
				row,
				listing: await listLegacyTimeCorrection(db, row, periodsById.get(row.entityId)),
			})),
		);

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
			legacyWorkflowIds.has(row.id)
				? []
				: mapCanonicalTimeCorrection(row, input),
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
	const periodsById = await loadLegacyTimeCorrectionPeriods(database, input, rows);
	const legacyWorkflowIds = new Set<string>();
	for (const row of rows) {
		const listing = await listLegacyTimeCorrection(database, row, periodsById.get(row.entityId));
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

async function loadLegacyTimeCorrectionPeriods(
	database: SelfServiceDatabase,
	input: { organizationId: string; employeeId: string },
	rows: TimeCorrectionRow[],
): Promise<Map<string, LegacyTimeCorrectionPeriod>> {
	if (rows.length === 0) return new Map();
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
	return new Map(periods.map((period) => [period.id, period]));
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
		if (
			!workflow.enumerable ||
			!("value" in workflow) ||
			!record(workflow.value)
		) {
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
			(cancellation.chainInstanceId === null &&
				submission.resultKind !== "default_created") ||
			(cancellation.chainInstanceId !== null &&
				submission.resultKind !== "chain_created")
		) {
			throw new Error();
		}
		const approvedAt = instantFromDB(row.approvedAt);
		if (
			!approvedAt ||
			compareInstants(parseInstant(cancellation.cancelledAt), approvedAt) !== 0
		) {
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
		(Object.getPrototypeOf(value) === Object.prototype ||
			Object.getPrototypeOf(value) === null)
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
		!keys.every((key) =>
			["key", "submissionId", "resultKind", "originalStatus"].includes(key),
		) ||
		typeof submission.key !== "string" ||
		submission.key.length === 0 ||
		(hasSubmissionId &&
			(typeof submission.submissionId !== "string" ||
				!UUID.test(submission.submissionId))) ||
		(submission.resultKind !== "default_created" &&
			submission.resultKind !== "chain_created" &&
			submission.resultKind !== "auto_completed") ||
		(submission.originalStatus !== "pending" &&
			submission.originalStatus !== "approved") ||
		(submission.resultKind === "auto_completed") !==
			(submission.originalStatus === "approved")
	) {
		throw new Error();
	}
	return correction;
}

function parseCanonicalTimeCorrectionDisplay(
	value: unknown,
	correction: ReturnType<
		typeof normalizeTimeCorrectionWorkflowPayload
	>["timeCorrection"],
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

function safeDisplayString(
	value: unknown,
	maxLength: number,
	allowEmpty: boolean,
): string {
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

function strictStringArrayEquals(
	value: unknown,
	expected: readonly string[],
): boolean {
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
		return (
			descriptor?.enumerable &&
			"value" in descriptor &&
			descriptor.value === item
		);
	});
}

async function loadAbsences(
	input: GetSelfServiceRequestsInput,
): Promise<SelfServiceRequestItem[]> {
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
				decisionReason:
					latestDecisionLog?.reason ?? latestDecisionLog?.comment ?? null,
				availableActions: actionsFor(status),
				sourceHref: "/travel-expenses",
			},
		];
	});
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

function mapTravelExpenseStatus(
	status: TravelExpenseRow["status"],
): SelfServiceRequestStatus {
	return status === "approved" || status === "rejected" ? status : "pending";
}

function travelExpenseSubtitle(row: TravelExpenseRow): string {
	const destination = [row.destinationCity, row.destinationCountry]
		.filter(Boolean)
		.join(", ");
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

	if (
		status === "pending" &&
		(sourceType === "absence" || sourceType === "time_correction")
	) {
		return ["cancel", "view"];
	}

	return ["view"];
}

function countItems(
	items: SelfServiceRequestItem[],
	now: Date,
): SelfServiceRequestCounts {
	const recentCutoff = DateTime.fromJSDate(now).minus({ days: 30 });

	return {
		pending: items.filter((item) => item.status === "pending").length,
		requiredFixes: items.filter(
			(item) =>
				item.status === "rejected" && item.availableActions.includes("fix"),
		).length,
		recentDecisions: items.filter((item) => {
			if (
				(item.status !== "approved" && item.status !== "rejected") ||
				item.resolvedAt === null
			) {
				return false;
			}

			return DateTime.fromJSDate(item.resolvedAt) >= recentCutoff;
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
		if (
			filters?.status &&
			filters.status !== "all" &&
			item.status !== filters.status
		) {
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

function compareItems(
	a: SelfServiceRequestItem,
	b: SelfServiceRequestItem,
): number {
	const statusDelta = statusRank(a.status) - statusRank(b.status);

	if (statusDelta !== 0) {
		return statusDelta;
	}

	return relevantDate(b).getTime() - relevantDate(a).getTime();
}

function statusRank(status: SelfServiceRequestStatus): number {
	if (status === "rejected") {
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
