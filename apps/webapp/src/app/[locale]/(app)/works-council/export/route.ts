import { DateTime } from "luxon";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { worksCouncilAccessAudit, worksCouncilReviewExport } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import { canExportWorksCouncilReview } from "@/lib/works-council/permissions";
import type { WorksCouncilPortalModel } from "@/lib/works-council/review-data";
import { buildWorksCouncilPortalModel } from "@/lib/works-council/review-data";
import { loadWorksCouncilSettings } from "@/lib/works-council/settings";

type ExportContext = {
	organizationId: string;
	userId: string;
	dateRangeStart: Date;
	dateRangeEnd: Date;
};

type VisibilitySnapshot = {
	identityVisibility: "aggregated" | "pseudonymized" | "named";
	absenceVisibility: "hidden" | "grouped" | "category";
	minimumAggregationThreshold: number;
	visibleTeamIds: string[];
	visibleLocationIds: string[];
};

const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

function parseDateRange(request: NextRequest) {
	const url = new URL(request.url);
	const now = DateTime.utc();
	const fromParam = url.searchParams.get("from");
	const toParam = url.searchParams.get("to");
	const start = fromParam
		? DateTime.fromISO(fromParam, { zone: "utc" }).startOf("day")
		: now.minus({ days: 30 }).startOf("day");
	const end = toParam ? DateTime.fromISO(toParam, { zone: "utc" }).endOf("day") : now.endOf("day");

	if (!start.isValid || !end.isValid || start > end) {
		return null;
	}

	return {
		dateRangeStart: start.toJSDate(),
		dateRangeEnd: end.toJSDate(),
		fileStart: start.toFormat("yyyyLLdd"),
		fileEnd: end.toFormat("yyyyLLdd"),
	};
}

function csvCell(value: unknown) {
	const text = value == null ? "" : String(value);
	return `"${text.replaceAll('"', '""')}"`;
}

function csvRow(values: unknown[]) {
	return values.map(csvCell).join(",");
}

function csvScopeList(values: string[]) {
	return values.length > 0 ? values.toSorted().join(";") : "all";
}

function csvMetricValue(
	value: WorksCouncilPortalModel["dashboard"] extends infer Dashboard
		? Dashboard extends null
			? never
			: Dashboard[keyof Dashboard]
		: never,
) {
	return value.state === "available" ? value.value : "insufficient_data";
}

function buildCsv(
	model: WorksCouncilPortalModel,
	snapshot: VisibilitySnapshot,
	context: ExportContext,
) {
	if (model.state !== "ready") {
		throw new Error("Works Council export model is not ready");
	}

	const rows = [
		csvRow(["Works Council Review Export"]),
		csvRow(["Organization", context.organizationId]),
		csvRow(["Date range start", context.dateRangeStart.toISOString()]),
		csvRow(["Date range end", context.dateRangeEnd.toISOString()]),
		csvRow(["Identity visibility", snapshot.identityVisibility]),
		csvRow(["Absence visibility", snapshot.absenceVisibility]),
		csvRow(["Minimum aggregation threshold", snapshot.minimumAggregationThreshold]),
		csvRow(["Visible team IDs", csvScopeList(snapshot.visibleTeamIds)]),
		csvRow(["Visible location IDs", csvScopeList(snapshot.visibleLocationIds)]),
		csvRow([]),
		csvRow(["Metric", "Value"]),
		csvRow(["Overtime minutes", csvMetricValue(model.dashboard.overtimeMinutes)]),
		csvRow(["Break/rest risk count", csvMetricValue(model.dashboard.breakRestRiskCount)]),
		csvRow(["Schedule publications", csvMetricValue(model.dashboard.schedulePublicationCount)]),
		csvRow(["Schedule changes", csvMetricValue(model.dashboard.scheduleChangeCount)]),
		csvRow(["Compliance findings", csvMetricValue(model.dashboard.complianceFindingCount)]),
		csvRow([
			"Absence coverage pressure",
			csvMetricValue(model.dashboard.absenceCoveragePressureCount),
		]),
		csvRow(["Policy changes", csvMetricValue(model.dashboard.policyChangeCount)]),
		csvRow([]),
		csvRow(["Change ID", "Timestamp", "Event type", "Actor", "Summary"]),
		...model.changeLog.map((entry) =>
			csvRow([entry.id, entry.timestamp, entry.eventType, entry.actorLabel, entry.summary]),
		),
		csvRow([]),
		csvRow(["Schedule ID", "Starts at", "Ends at", "Team", "Employee"]),
		...model.scheduleReview.map((entry) =>
			csvRow([entry.id, entry.startsAt, entry.endsAt, entry.teamName, entry.employeeName]),
		),
	];

	return {
		csv: `${rows.join("\n")}\n`,
		rowCount: model.changeLog.length + model.scheduleReview.length,
	};
}

async function auditExportFailed(context: ExportContext, error: unknown) {
	await db.insert(worksCouncilAccessAudit).values({
		organizationId: context.organizationId,
		actorUserId: context.userId,
		eventType: "export_failed",
		dateRangeStart: context.dateRangeStart,
		dateRangeEnd: context.dateRangeEnd,
		metadata: {
			errorCode: "export_generation_failed",
			errorType: error instanceof Error ? error.name : "UnknownError",
		},
	});
}

export async function GET(request: NextRequest) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const activeOrganizationId = session.session?.activeOrganizationId;
	if (!activeOrganizationId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}
	const organizationId = activeOrganizationId;

	const dateRange = parseDateRange(request);
	if (!dateRange) {
		return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
	}

	const context: ExportContext = {
		organizationId,
		userId: session.user.id,
		dateRangeStart: dateRange.dateRangeStart,
		dateRangeEnd: dateRange.dateRangeEnd,
	};

	try {
		const ability = await getAbility();
		if (!ability || !canExportWorksCouncilReview(ability, organizationId, activeOrganizationId)) {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		const settings = await loadWorksCouncilSettings(organizationId);
		if (!settings.enabled || !settings.exportEnabled) {
			return NextResponse.json({ error: "Works Council exports are disabled" }, { status: 403 });
		}

		const visibilitySnapshot: VisibilitySnapshot = {
			identityVisibility: settings.identityVisibility,
			absenceVisibility: settings.absenceVisibility,
			minimumAggregationThreshold: settings.minimumAggregationThreshold,
			visibleTeamIds: settings.visibleTeamIds,
			visibleLocationIds: settings.visibleLocationIds,
		};

		const model = await buildWorksCouncilPortalModel({
			organizationId,
			actorUserId: session.user.id,
			dateRangeStart: dateRange.dateRangeStart,
			dateRangeEnd: dateRange.dateRangeEnd,
			settings,
		});
		const { csv, rowCount } = buildCsv(model, visibilitySnapshot, context);

		await db.insert(worksCouncilReviewExport).values({
			organizationId,
			requestedByUserId: session.user.id,
			dateRangeStart: dateRange.dateRangeStart,
			dateRangeEnd: dateRange.dateRangeEnd,
			visibilitySnapshot,
			status: "completed",
			rowCount,
		});
		await db.insert(worksCouncilAccessAudit).values({
			organizationId,
			actorUserId: session.user.id,
			eventType: "export_requested",
			dateRangeStart: dateRange.dateRangeStart,
			dateRangeEnd: dateRange.dateRangeEnd,
			metadata: { rowCount, visibilitySnapshot },
		});

		return new Response(csv, {
			status: 200,
			headers: {
				"content-type": CSV_CONTENT_TYPE,
				"content-disposition": `attachment; filename="works-council-review-${dateRange.fileStart}-${dateRange.fileEnd}.csv"`,
			},
		});
	} catch (error) {
		await auditExportFailed(context, error);
		return NextResponse.json({ error: "Failed to generate Works Council export" }, { status: 500 });
	}
}
