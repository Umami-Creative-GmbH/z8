import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { worksCouncilAccessAudit, worksCouncilReviewExport } from "@/db/schema";
import { auth } from "@/lib/auth";
import { getAbility } from "@/lib/auth-helpers";
import {
	comparePlainDates,
	dateFromInstant,
	parseInstant,
	parsePlainDate,
	type PlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { canExportWorksCouncilReview } from "@/lib/works-council/permissions";
import {
	type PositionCaptureReview,
	positionCaptureReviewCsvRows,
} from "@/lib/works-council/position-capture-review";
import { loadWorksCouncilPositionCaptureReview } from "@/lib/works-council/position-capture-review-data";
import type { WorksCouncilPortalModel } from "@/lib/works-council/review-data";
import { buildWorksCouncilPortalModel } from "@/lib/works-council/review-data";
import { loadWorksCouncilSettings } from "@/lib/works-council/settings";
import {
	type VehicleUseReview,
	vehicleUseReviewCsvRows,
} from "@/lib/works-council/vehicle-use-review";
import { loadWorksCouncilVehicleUseReview } from "@/lib/works-council/vehicle-use-review-data";

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

function parseUtcDateParam(value: string): PlainDate | null {
	try {
		return parsePlainDate(value);
	} catch {
		try {
			return parseInstant(value).toZonedDateTimeISO("UTC").toPlainDate();
		} catch {
			return null;
		}
	}
}

function parseDateRange(request: NextRequest) {
	const url = new URL(request.url);
	const today = systemClock.nowInstant().toZonedDateTimeISO("UTC").toPlainDate();
	const fromParam = url.searchParams.get("from");
	const toParam = url.searchParams.get("to");
	const start = fromParam ? parseUtcDateParam(fromParam) : today.subtract({ days: 30 });
	const end = toParam ? parseUtcDateParam(toParam) : today;

	if (!start || !end || comparePlainDates(start, end) > 0) {
		return null;
	}

	return {
		dateRangeStart: dateFromInstant(start.toZonedDateTime("UTC").toInstant()),
		dateRangeEnd: dateFromInstant(
			end.add({ days: 1 }).toZonedDateTime("UTC").toInstant().subtract({ milliseconds: 1 }),
		),
		fileStart: start.toString().replaceAll("-", ""),
		fileEnd: end.toString().replaceAll("-", ""),
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
	positionCapture: PositionCaptureReview,
	vehicleUse: VehicleUseReview,
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
		csvRow([]),
		// Configuration, consent counts and the access log only: never a position (#834).
		...positionCaptureReviewCsvRows(positionCapture).map(csvRow),
		csvRow([]),
		// Configuration, covered employees and vehicle count only: never a reading or distance (#1130).
		...vehicleUseReviewCsvRows(vehicleUse).map(csvRow),
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

export async function POST(request: NextRequest) {
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

		const currentOrganization = await db.query.organization.findFirst({
			columns: { worksCouncilEnabled: true },
			where: eq(organization.id, organizationId),
		});
		if (!currentOrganization?.worksCouncilEnabled) {
			return NextResponse.json({ error: "Forbidden" }, { status: 403 });
		}

		const settings = await loadWorksCouncilSettings(organizationId);
		if (!settings.exportEnabled) {
			return NextResponse.json({ error: "Works Council exports are disabled" }, { status: 403 });
		}

		const visibilitySnapshot: VisibilitySnapshot = {
			identityVisibility: settings.identityVisibility,
			absenceVisibility: settings.absenceVisibility,
			minimumAggregationThreshold: settings.minimumAggregationThreshold,
			visibleTeamIds: settings.visibleTeamIds,
			visibleLocationIds: settings.visibleLocationIds,
		};

		const [model, positionCapture, vehicleUse] = await Promise.all([
			buildWorksCouncilPortalModel({
				organizationId,
				actorUserId: session.user.id,
				dateRangeStart: dateRange.dateRangeStart,
				dateRangeEnd: dateRange.dateRangeEnd,
				settings,
			}),
			loadWorksCouncilPositionCaptureReview({ organizationId, settings }),
			loadWorksCouncilVehicleUseReview({ organizationId, settings }),
		]);
		const { csv, rowCount } = buildCsv(
			model,
			positionCapture,
			vehicleUse,
			visibilitySnapshot,
			context,
		);

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
