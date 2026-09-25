/**
 * Scoped payroll-ready work collection (#322 / T57), the database part.
 *
 * `collectPayrollWork` hides the whole choreography from payroll callers:
 *
 * 1. Eligible evidence-backed repairs (#320) run first, in their own short
 *    coordinated per-employee transactions, and only when the organization has
 *    authorized repair. Nothing else is repaired; stale plans are left to the final
 *    readiness check.
 * 2. Final readiness and collection then run in **one** read-only repeatable-read
 *    snapshot: scope resolution, every in-scope work record in any state, its
 *    detail, allocations and linking periods, the historical diagnostics (#319) over
 *    the scoped employees' whole history, and unrepaired departure timers. A
 *    concurrent write either lands before the snapshot, and is assessed, or after
 *    it, and is not collected.
 *
 * It returns immutable collected input or scoped blockers; formatting, delivery and
 * other export prerequisites stay with their owners.
 */
import "server-only";

import { and, eq, gte, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import type { db as database } from "@/db";
import { organization, user } from "@/db/auth-schema";
import {
	approvalRequest,
	employee,
	historicalWorkRepairControl,
	payrollWorkCollectionControl,
	project,
	timeRecord,
	timeRecordAllocation,
	timeRecordWork,
	userSettings,
	workCategory,
} from "@/db/schema";
import { dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import { findOpenDepartureClockRepairs } from "@/lib/employee-lifecycle/reviews";
import { createLogger } from "@/lib/logger";
import { withAppendEvidenceSnapshot } from "@/lib/time-tracking/append-assurance-reader";
import {
	applyHistoricalGapRepair,
	type EmployeeRepairOutcome,
	HistoricalRepairNotAuthorizedError,
	readHistoricalGapRepairPlan,
} from "@/lib/time-tracking/historical-gap-repair-executor";
import {
	assessHistoricalWork,
	calendarDateEnvelope,
} from "@/lib/time-tracking/historical-work-diagnostics";
import {
	type HistoricalWorkEvidenceReader,
	readHistoricalWorkEvidence,
} from "@/lib/time-tracking/historical-work-diagnostics-reader";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import {
	assessPayrollWorkCollection,
	type PayrollCollectionRequest,
	type PayrollCollectionSnapshot,
	type PayrollCollectionWorkRecord,
	type PayrollWorkCollection,
} from "./payroll-work-collection";

type Database = typeof database;
type Reader = HistoricalWorkEvidenceReader;

const logger = createLogger("PayrollWorkCollection");

/** Recorded as the reason on every repair receipt a payroll collection causes. */
export const PAYROLL_COLLECTION_REPAIR_REASON =
	"Eligible historical gap repair before payroll work collection";

/** Keeps each `IN` list well under PostgreSQL's bind-parameter limit. */
const ID_CHUNK = 5_000;

export interface PayrollCollectionFilters {
	/** Inclusive calendar dates, interpreted in each employee's zone. */
	startDate: string;
	endDate: string;
	/** Explicit employees and/or teams (intersected); otherwise the whole organization. */
	employeeIds?: readonly string[];
	teamIds?: readonly string[];
	projectIds?: readonly string[];
}

export type PayrollCollectionRepair =
	| { status: "not_requested" | "not_authorized" | "nothing_eligible" }
	| { status: "attempted"; outcomes: EmployeeRepairOutcome[] };

export interface CollectedPayrollWorkRead {
	collection: PayrollWorkCollection;
	repair: PayrollCollectionRepair;
}

/** Whether the organization has activated scoped payroll collection. */
export async function isPayrollWorkCollectionActive(
	reader: Reader,
	organizationId: string,
): Promise<boolean> {
	const [control] = await reader
		.select({ mode: payrollWorkCollectionControl.mode })
		.from(payrollWorkCollectionControl)
		.where(eq(payrollWorkCollectionControl.organizationId, organizationId))
		.limit(1);
	return control?.mode === "active";
}

/**
 * Repairs eligible gaps, then assesses and collects the scope in one snapshot.
 * `repairActorUserId` is the authenticated requester recorded as the repair
 * executor; `null` skips repair.
 */
export async function collectPayrollWork(
	db: Database,
	input: {
		organizationId: string;
		filters: PayrollCollectionFilters;
		repairActorUserId: string | null;
	},
): Promise<CollectedPayrollWorkRead> {
	const repair = input.repairActorUserId
		? await repairEligibleGaps(db, input.organizationId, input.filters, input.repairActorUserId)
		: ({ status: "not_requested" } as const);
	const collection = await readPayrollWorkCollection(db, input.organizationId, input.filters);
	return { collection, repair };
}

/**
 * Readiness and collection in one read-only repeatable-read snapshot, without
 * repair. The payroll workspace reads this and may show it as incomplete.
 */
export function readPayrollWorkCollection(
	db: Database,
	organizationId: string,
	filters: PayrollCollectionFilters,
): Promise<PayrollWorkCollection> {
	return withAppendEvidenceSnapshot(db, async (reader) => {
		const employeeIds = await resolveScopeEmployeeIds(reader, organizationId, filters);
		const request: PayrollCollectionRequest = {
			organizationId,
			startDate: filters.startDate,
			endDate: filters.endDate,
			employeeIds,
			teamIds: filters.teamIds ?? null,
			projectIds: filters.projectIds ?? null,
		};
		const snapshot = await readPayrollCollectionSnapshot(reader, request);
		return assessPayrollWorkCollection(snapshot, request);
	});
}

async function repairEligibleGaps(
	db: Database,
	organizationId: string,
	filters: PayrollCollectionFilters,
	actorUserId: string,
): Promise<PayrollCollectionRepair> {
	// Cheap authorization check first: an unauthorized organization reads no plan.
	const [control] = await db
		.select({ mode: historicalWorkRepairControl.mode })
		.from(historicalWorkRepairControl)
		.where(eq(historicalWorkRepairControl.organizationId, organizationId))
		.limit(1);
	if (control?.mode !== "active") return { status: "not_authorized" };

	const employeeIds = await resolveScopeEmployeeIds(db, organizationId, filters);
	if (employeeIds.length === 0) return { status: "nothing_eligible" };
	const range = calendarDateEnvelope(filters.startDate, filters.endDate);
	const { repair } = await readHistoricalGapRepairPlan(db, organizationId, { employeeIds, range });
	if (!repair.authorized) return { status: "not_authorized" };
	const expected = repair.plan.employees
		.filter((plan) => plan.units.length > 0)
		.map(({ employeeId, fingerprint }) => ({ employeeId, fingerprint }));
	if (expected.length === 0) return { status: "nothing_eligible" };

	try {
		const outcomes = await applyHistoricalGapRepair({
			organizationId,
			actorUserId,
			range,
			expected,
			reason: PAYROLL_COLLECTION_REPAIR_REASON,
		});
		logger.info(
			{
				organizationId,
				outcomes: outcomes.map(({ employeeId, status }) => ({ employeeId, status })),
			},
			"Eligible historical gaps repaired before payroll collection",
		);
		return { status: "attempted", outcomes };
	} catch (error) {
		// Authorization was withdrawn after the plan was read: collect without repair.
		if (error instanceof HistoricalRepairNotAuthorizedError) return { status: "not_authorized" };
		throw error;
	}
}

/** The organization's employees the filters select, sorted. */
async function resolveScopeEmployeeIds(
	reader: Reader,
	organizationId: string,
	filters: PayrollCollectionFilters,
): Promise<string[]> {
	let where: SQL | undefined = eq(employee.organizationId, organizationId);
	if (filters.employeeIds !== undefined) {
		if (filters.employeeIds.length === 0) return [];
		where = and(where, inArray(employee.id, [...filters.employeeIds]));
	}
	if (filters.teamIds && filters.teamIds.length > 0) {
		where = and(where, inArray(employee.teamId, [...filters.teamIds]));
	}
	const rows = await reader.select({ id: employee.id }).from(employee).where(where);
	return rows.map((row) => row.id).toSorted();
}

async function readPayrollCollectionSnapshot(
	reader: Reader,
	request: PayrollCollectionRequest,
): Promise<PayrollCollectionSnapshot> {
	const { organizationId, employeeIds } = request;
	const range = calendarDateEnvelope(request.startDate, request.endDate);
	const diagnosticsScope = { employeeIds, range };
	if (employeeIds.length === 0) {
		return {
			employees: [],
			records: [],
			diagnostics: { completeness: { status: "complete", widenedTo: "requested" }, findings: [] },
			departureRepairs: [],
		};
	}

	const [organizationRow] = await reader
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1);
	const employeeRows = await selectInChunks(employeeIds, (chunk) =>
		reader
			.select({
				id: employee.id,
				employeeNumber: employee.employeeNumber,
				firstName: user.firstName,
				lastName: user.lastName,
				email: user.email,
				timezone: userSettings.timezone,
			})
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
			.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, chunk))),
	);

	// Every record that can touch an employee-local window, in any approval state:
	// open work, reversed endpoints and everything overlapping the widest envelope.
	const rangeStart = dateFromInstant(range.start);
	const rangeEnd = dateFromInstant(range.endExclusive);
	const recordRows = await selectInChunks(employeeIds, (chunk) =>
		reader
			.select({
				id: timeRecord.id,
				employeeId: timeRecord.employeeId,
				startAt: timeRecord.startAt,
				endAt: timeRecord.endAt,
				durationMinutes: timeRecord.durationMinutes,
				approvalState: timeRecord.approvalState,
				updatedAt: timeRecord.updatedAt,
			})
			.from(timeRecord)
			.where(
				and(
					eq(timeRecord.organizationId, organizationId),
					eq(timeRecord.recordKind, "work"),
					inArray(timeRecord.employeeId, chunk),
					or(
						and(
							lt(timeRecord.startAt, rangeEnd),
							or(isNull(timeRecord.endAt), gte(timeRecord.endAt, rangeStart)),
						),
						// Reversed endpoints: the hull of both instants.
						and(
							lt(timeRecord.endAt, timeRecord.startAt),
							lt(timeRecord.endAt, rangeEnd),
							gte(timeRecord.startAt, rangeStart),
						),
					),
				),
			),
	);
	const recordIds = recordRows.map((row) => row.id);
	const details = await selectInChunks(recordIds, (chunk) =>
		reader
			.select({
				recordId: timeRecordWork.recordId,
				categoryId: workCategory.id,
				categoryName: workCategory.name,
				categoryFactor: workCategory.factor,
			})
			.from(timeRecordWork)
			.leftJoin(
				workCategory,
				and(
					eq(workCategory.id, timeRecordWork.workCategoryId),
					eq(workCategory.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(timeRecordWork.organizationId, organizationId),
					inArray(timeRecordWork.recordId, chunk),
				),
			),
	);
	const allocations = await selectInChunks(recordIds, (chunk) =>
		reader
			.select({
				recordId: timeRecordAllocation.recordId,
				projectId: project.id,
				projectName: project.name,
				weightPercent: timeRecordAllocation.weightPercent,
			})
			.from(timeRecordAllocation)
			.innerJoin(
				project,
				and(
					eq(project.id, timeRecordAllocation.projectId),
					eq(project.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(timeRecordAllocation.organizationId, organizationId),
					eq(timeRecordAllocation.allocationKind, "project"),
					inArray(timeRecordAllocation.recordId, chunk),
				),
			),
	);
	// Corrections of these records that still await a decision.
	const correctedRecordIds = new Set(
		(
			await selectInChunks(recordIds, (chunk) =>
				reader
					.select({ recordId: approvalRequest.canonicalRecordId })
					.from(approvalRequest)
					.where(
						and(
							eq(approvalRequest.organizationId, organizationId),
							eq(approvalRequest.entityType, "time_entry"),
							eq(approvalRequest.status, "pending"),
							inArray(approvalRequest.canonicalRecordId, chunk),
						),
					),
			)
		).map((row) => row.recordId),
	);

	// Whole-history evidence of the scoped employees, before any filter.
	const evidence = await readHistoricalWorkEvidence(reader, organizationId, employeeIds);
	const diagnostics = assessHistoricalWork(evidence, diagnosticsScope);
	const departureRepairs = await findOpenDepartureClockRepairs(reader as Pick<Database, "select">, {
		organizationId,
		employeeIds,
		rangeStart,
		rangeEndExclusive: rangeEnd,
	});

	const linkingPeriod = new Map<string, PayrollCollectionWorkRecord["workPeriod"]>();
	for (const period of evidence.periods.toSorted((left, right) => compare(left.id, right.id))) {
		if (period.canonicalRecordId === null) continue;
		// Legacy pending changes on any linking period are an undecided correction.
		if (period.hasPendingChanges) correctedRecordIds.add(period.canonicalRecordId);
		if (linkingPeriod.has(period.canonicalRecordId)) continue;
		linkingPeriod.set(period.canonicalRecordId, {
			id: period.id,
			graphRevision: period.graphRevision,
			deleted: period.deletedAt !== null,
		});
	}
	const detailByRecord = new Map(details.map((row) => [row.recordId, row]));
	const projectsByRecord = new Map<string, PayrollCollectionWorkRecord["projects"][number][]>();
	for (const row of allocations) {
		projectsByRecord.set(row.recordId, [
			...(projectsByRecord.get(row.recordId) ?? []),
			{ projectId: row.projectId, name: row.projectName, weightPercent: row.weightPercent },
		]);
	}

	return {
		employees: employeeRows.map((row) => ({
			id: row.id,
			employeeNumber: row.employeeNumber,
			firstName: row.firstName,
			lastName: row.lastName,
			email: row.email,
			timezone: resolveEffectiveTimezone(row.timezone, organizationRow?.timezone ?? null),
		})),
		records: recordRows.map((row): PayrollCollectionWorkRecord => {
			const detail = detailByRecord.get(row.id);
			return {
				id: row.id,
				employeeId: row.employeeId,
				startAt: instantFromDate(row.startAt),
				endAt: row.endAt ? instantFromDate(row.endAt) : null,
				durationMinutes: row.durationMinutes,
				approvalState: row.approvalState,
				updatedAt: instantFromDate(row.updatedAt),
				workPeriod: linkingPeriod.get(row.id) ?? null,
				pendingCorrection: correctedRecordIds.has(row.id),
				workCategory:
					detail?.categoryId && detail.categoryName
						? { id: detail.categoryId, name: detail.categoryName, factor: detail.categoryFactor }
						: null,
				projects: projectsByRecord.get(row.id) ?? [],
			};
		}),
		diagnostics,
		departureRepairs: departureRepairs.map((repair) => ({
			reviewId: repair.reviewId,
			employeeId: repair.employeeId,
			affectedEndAt: repair.affectedEndAt ? instantFromDate(repair.affectedEndAt) : null,
		})),
	};
}

async function selectInChunks<T>(
	ids: readonly string[],
	select: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
	const unique = [...new Set(ids)];
	const rows: T[] = [];
	// Sequential: the snapshot is one connection.
	for (let index = 0; index < unique.length; index += ID_CHUNK) {
		rows.push(...(await select(unique.slice(index, index + ID_CHUNK))));
	}
	return rows;
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
