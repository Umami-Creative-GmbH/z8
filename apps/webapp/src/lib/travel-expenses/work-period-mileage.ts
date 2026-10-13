import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { timeEntry, travelExpenseReport, travelExpenseReportItem, workPeriod } from "@/db/schema";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { isConstraintViolation } from "@/lib/projects/constraint-violation";
import { parseMileageDistance } from "./mileage";
import {
	insertStandaloneMileageReport,
	insertTripMileageItem,
	type MileageItemPrefill,
} from "./mileage-item-store";
import type { ReportOwner } from "./report-store";

/**
 * Mileage item from own-vehicle work (#1131, spec #807; Time Tracking glossary
 * "Driving"). Work driven in the employee's **own vehicle** with a driven
 * distance can pre-fill one mileage item: the work's local start date, the
 * distance and the vehicle class `car` (changeable); the employee enters the
 * route. The item remembers its source work period, and a partial unique
 * index keeps a work period's distance in at most one item. Deleting the item
 * (or its never-submitted draft report) releases the work period again.
 *
 * Pricing, submission and reimbursement stay with the item, unchanged. The
 * work period is only read here, never locked: travel expenses stay outside
 * the time-tracking lock order (Time Tracking ADR 0001).
 */

type Database = typeof appDb;

const SOURCE_INDEX = "travelExpenseReportItem_org_sourceWorkPeriod_idx";

/** A draft trip the work's mileage can be added to. */
export interface WorkMileageTripChoice {
	id: string;
	purpose: string | null;
	startDate: string | null;
	endDate: string | null;
}

export type WorkPeriodMileage =
	| {
			status: "available";
			/** The work's local start date (YYYY-MM-DD), at its clock-in's offset. */
			expenseDate: string;
			/** Driven distance in whole kilometres. */
			distanceKm: number;
			trips: WorkMileageTripChoice[];
	  }
	/** The distance is in a mileage item already; the report is the owner's. */
	| { status: "added"; reportId: string | null }
	/** Not the owner's completed own-vehicle work with a driven distance. */
	| { status: "unavailable" };

/** The owner's completed own-vehicle work with a driven distance, as a pre-fill. */
async function loadEligibleWork(
	database: Database,
	owner: ReportOwner,
	workPeriodId: string,
): Promise<MileageItemPrefill | null> {
	const [work] = await database
		.select({
			startTime: workPeriod.startTime,
			distanceKm: workPeriod.drivenDistanceKm,
			offsetMinutes: timeEntry.utcOffsetMinutes,
		})
		.from(workPeriod)
		.innerJoin(
			timeEntry,
			and(
				eq(timeEntry.id, workPeriod.clockInId),
				eq(timeEntry.organizationId, workPeriod.organizationId),
			),
		)
		.where(
			and(
				eq(workPeriod.id, workPeriodId),
				eq(workPeriod.organizationId, owner.organizationId),
				eq(workPeriod.employeeId, owner.employeeId),
				isNull(workPeriod.deletedAt),
				isNotNull(workPeriod.endTime),
				eq(workPeriod.vehicleKind, "own"),
				gt(workPeriod.drivenDistanceKm, 0),
			),
		)
		.limit(1);
	if (!work || work.distanceKm === null) return null;
	const distanceKm = parseMileageDistance(String(work.distanceKm));
	if (distanceKm === null) return null;
	// The work's own local day (docs/refs/timekeeping.md), never a viewer's zone.
	const expenseDate = instantFromDate(work.startTime)
		.toZonedDateTimeISO(offsetMinutesToTimeZoneId(work.offsetMinutes))
		.toPlainDate()
		.toString();
	return { expenseDate, distanceKm, sourceWorkPeriodId: workPeriodId };
}

/** The item already holding the work period's distance, with its report when the owner's. */
async function loadAddedItem(database: Database, owner: ReportOwner, workPeriodId: string) {
	const [item] = await database
		.select({
			reportId: travelExpenseReportItem.reportId,
			employeeId: travelExpenseReport.employeeId,
		})
		.from(travelExpenseReportItem)
		.innerJoin(
			travelExpenseReport,
			and(
				eq(travelExpenseReport.id, travelExpenseReportItem.reportId),
				eq(travelExpenseReport.organizationId, travelExpenseReportItem.organizationId),
			),
		)
		.where(
			and(
				eq(travelExpenseReportItem.organizationId, owner.organizationId),
				eq(travelExpenseReportItem.sourceWorkPeriodId, workPeriodId),
			),
		)
		.limit(1);
	if (!item) return null;
	return { reportId: item.employeeId === owner.employeeId ? item.reportId : null };
}

/** Whether the owner can add the work's mileage to an expense report, and where. */
export async function loadWorkPeriodMileage(
	database: Database,
	owner: ReportOwner,
	workPeriodId: string,
): Promise<WorkPeriodMileage> {
	const work = await loadEligibleWork(database, owner, workPeriodId);
	if (!work) return { status: "unavailable" };
	const added = await loadAddedItem(database, owner, workPeriodId);
	if (added) return { status: "added", reportId: added.reportId };
	const trips = await database
		.select({
			id: travelExpenseReport.id,
			purpose: travelExpenseReport.tripPurpose,
			startDate: travelExpenseReport.tripStartDate,
			endDate: travelExpenseReport.tripEndDate,
		})
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.organizationId, owner.organizationId),
				eq(travelExpenseReport.employeeId, owner.employeeId),
				eq(travelExpenseReport.kind, "trip"),
				eq(travelExpenseReport.status, "draft"),
			),
		)
		.orderBy(desc(travelExpenseReport.updatedAt), desc(travelExpenseReport.id));
	return {
		status: "available",
		expenseDate: work.expenseDate,
		distanceKm: Number(work.distanceKm),
		trips,
	};
}

export type AddWorkPeriodMileageResult =
	| { kind: "added"; reportId: string; itemId: string }
	/** The work period's distance is in a mileage item already; nothing was written. */
	| { kind: "already_added"; reportId: string | null }
	/** Not the owner's completed own-vehicle work with a driven distance. */
	| { kind: "unavailable" }
	/** The target trip is not the owner's draft trip. */
	| { kind: "not_found" }
	| { kind: "not_draft" };

/**
 * Adds a mileage item pre-filled from the owner's own-vehicle work to their
 * draft trip (`reportId`) or to a new standalone report (`reportId: null`).
 * A second request for the same work period, concurrent or not, is refused.
 */
export async function addWorkPeriodMileage(
	database: Database,
	owner: ReportOwner,
	input: { workPeriodId: string; reportId: string | null },
	now: Instant = systemClock.nowInstant(),
): Promise<AddWorkPeriodMileageResult> {
	const at = dateFromInstant(now);
	const work = await loadEligibleWork(database, owner, input.workPeriodId);
	if (!work) return { kind: "unavailable" };
	const added = await loadAddedItem(database, owner, input.workPeriodId);
	if (added) return { kind: "already_added", reportId: added.reportId };
	try {
		return await database.transaction(async (tx): Promise<AddWorkPeriodMileageResult> => {
			if (input.reportId === null) {
				return { kind: "added", ...(await insertStandaloneMileageReport(tx, owner, at, work)) };
			}
			const result = await insertTripMileageItem(tx, owner, input.reportId, at, work);
			if (result.kind !== "added") return result;
			return { kind: "added", reportId: input.reportId, itemId: result.item.id };
		});
	} catch (error) {
		// A concurrent request added the work period first; this whole transaction rolled back.
		if (!isConstraintViolation(error, "23505", SOURCE_INDEX)) throw error;
		const winner = await loadAddedItem(database, owner, input.workPeriodId);
		return { kind: "already_added", reportId: winner?.reportId ?? null };
	}
}
