import { and, desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";

import { db } from "@/db";
import { absenceEntry, approvalRequest, travelExpenseClaim } from "@/db/schema";

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
	decisionLogs?: Array<{ reason: string | null; comment: string | null; createdAt: Date }>;
}

const SOURCE_ERROR_MESSAGES: Record<SelfServiceRequestSourceType, string> = {
	time_correction: "Time correction requests could not be loaded.",
	absence: "Absence requests could not be loaded.",
	travel_expense: "Travel expense requests could not be loaded.",
};

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
			sourceErrors: [{ sourceType, message: SOURCE_ERROR_MESSAGES[sourceType] }],
		};
	}
}

async function loadTimeCorrections(
	input: GetSelfServiceRequestsInput,
): Promise<SelfServiceRequestItem[]> {
	const rows = (await db.query.approvalRequest.findMany({
		where: and(
			eq(approvalRequest.organizationId, input.organizationId),
			eq(approvalRequest.requestedBy, input.employeeId),
			eq(approvalRequest.entityType, "time_entry"),
		),
		orderBy: [desc(approvalRequest.createdAt)],
	})) as TimeCorrectionRow[];

	return rows.map((row) => ({
		id: `time_correction:${row.id}`,
		sourceType: "time_correction",
		sourceId: row.id,
		organizationId: row.organizationId,
		employeeId: row.requestedBy,
		status: row.status,
		submittedAt: row.createdAt,
		resolvedAt: row.approvedAt,
		title: "Time correction request",
		subtitle: "Correction for a time entry",
		decisionReason: row.rejectionReason,
		availableActions: actionsFor(row.status),
		sourceHref: "/time-tracking",
	}));
}

async function loadAbsences(input: GetSelfServiceRequestsInput): Promise<SelfServiceRequestItem[]> {
	const rows = (await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.organizationId, input.organizationId),
			eq(absenceEntry.employeeId, input.employeeId),
		),
		with: { category: true },
		orderBy: [desc(absenceEntry.createdAt)],
	})) as AbsenceRow[];

	return rows.map((row) => ({
		id: `absence:${row.id}`,
		sourceType: "absence",
		sourceId: row.id,
		organizationId: row.organizationId,
		employeeId: row.employeeId,
		status: row.status,
		submittedAt: row.createdAt,
		resolvedAt: row.approvedAt,
		title: `${row.category?.name ?? "Absence"} request`,
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
		),
		with: { decisionLogs: true },
		orderBy: [desc(travelExpenseClaim.createdAt)],
	})) as TravelExpenseRow[];

	return rows.map((row) => {
		const status = mapTravelExpenseStatus(row.status);
		const latestDecisionLog = row.decisionLogs?.toSorted(
			(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
		)[0];

		return {
			id: `travel_expense:${row.id}`,
			sourceType: "travel_expense",
			sourceId: row.id,
			organizationId: row.organizationId,
			employeeId: row.employeeId,
			status,
			submittedAt: row.submittedAt ?? row.createdAt,
			resolvedAt: row.decidedAt,
			title: "Travel expense claim",
			subtitle: travelExpenseSubtitle(row),
			decisionReason: latestDecisionLog?.reason ?? latestDecisionLog?.comment ?? null,
			availableActions: actionsFor(status),
			sourceHref: "/travel-expenses",
		};
	});
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

	if (status === "pending" && sourceType === "absence") {
		return ["cancel", "view"];
	}

	return ["view"];
}

function countItems(items: SelfServiceRequestItem[], now: Date): SelfServiceRequestCounts {
	const recentCutoff = DateTime.fromJSDate(now).minus({ days: 30 });

	return {
		pending: items.filter((item) => item.status === "pending").length,
		requiredFixes: items.filter((item) => item.status === "rejected").length,
		recentDecisions: items.filter((item) => {
			if ((item.status !== "approved" && item.status !== "rejected") || item.resolvedAt === null) {
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
