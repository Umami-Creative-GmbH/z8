import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { absenceCategory, absenceEntry, timeEntry, workPeriod } from "@/db/schema";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import type { ClockinClient } from "./client";
import {
	isClockinAbsenceDuplicate,
	isClockinWorkdayDuplicate,
} from "./duplicate-detection";
import type {
	ClockinEntityImportResult,
	ClockinImportResult,
	ClockinImportSelections,
	ClockinImportUserMapping,
	ClockinMappedAbsence,
	ClockinMappedWorkday,
	ExistingAbsenceCandidate,
	ExistingWorkPeriodCandidate,
} from "./import-types";

function emptyResult(): ClockinEntityImportResult {
	return { imported: 0, skipped: 0, errors: [] };
}

function mapAbsenceCategory(name: string | null): {
	type: "vacation" | "sick" | "home_office" | "personal" | "unpaid" | "parental" | "bereavement" | "custom";
	countsAgainstVacation: boolean;
	name: string;
} {
	const normalized = (name ?? "Imported absence").toLowerCase();

	if (normalized.includes("vacation") || normalized.includes("holiday")) {
		return { type: "vacation", countsAgainstVacation: true, name: name ?? "Vacation" };
	}
	if (normalized.includes("sick")) {
		return { type: "sick", countsAgainstVacation: false, name: name ?? "Sick" };
	}
	if (normalized.includes("home")) {
		return { type: "home_office", countsAgainstVacation: false, name: name ?? "Home Office" };
	}
	if (normalized.includes("unpaid")) {
		return { type: "unpaid", countsAgainstVacation: false, name: name ?? "Unpaid" };
	}

	return { type: "custom", countsAgainstVacation: false, name: name ?? "Imported absence" };
}

type TimeEntryChainState = { previousHash: string | null; previousEntryId: string | null };

export interface ClockinImportDependencies {
	fetchExistingWorkPeriods(input: {
		organizationId: string;
		employeeIds: string[];
		startDate: string;
		endDate: string;
	}): Promise<ExistingWorkPeriodCandidate[]>;
	fetchExistingAbsences(input: {
		organizationId: string;
		employeeIds: string[];
		startDate: string;
		endDate: string;
	}): Promise<ExistingAbsenceCandidate[]>;
	getTimeEntryChainState(employeeId: string): Promise<TimeEntryChainState>;
	insertTimeEntry(input: {
		employeeId: string;
		organizationId: string;
		type: "clock_in" | "clock_out";
		timestamp: Date;
		hash: string;
		previousHash: string | null;
		previousEntryId: string | null;
		createdBy: string;
		notes?: string | null;
	}): Promise<{ id: string; hash: string }>;
	insertWorkPeriod(input: {
		employeeId: string;
		organizationId: string;
		clockInId: string;
		clockOutId: string | null;
		startTime: Date;
		endTime: Date | null;
		durationMinutes: number | null;
		isActive: boolean;
	}): Promise<void>;
	ensureAbsenceCategory(input: {
		organizationId: string;
		name: string;
		type: "vacation" | "sick" | "home_office" | "personal" | "unpaid" | "parental" | "bereavement" | "custom";
		countsAgainstVacation: boolean;
	}): Promise<string>;
	insertAbsence(input: {
		employeeId: string;
		organizationId: string;
		categoryId: string;
		startDate: string;
		endDate: string;
		status: "approved";
		notes: string | null;
	}): Promise<void>;
}

const defaultDependencies: ClockinImportDependencies = {
	async fetchExistingWorkPeriods({ organizationId, employeeIds, startDate, endDate }) {
		if (employeeIds.length === 0) return [];

		return db
			.select({ employeeId: workPeriod.employeeId, startTime: workPeriod.startTime, endTime: workPeriod.endTime })
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.organizationId, organizationId),
					inArray(workPeriod.employeeId, employeeIds),
					gte(workPeriod.startTime, new Date(`${startDate}T00:00:00.000Z`)),
					lte(workPeriod.startTime, new Date(`${endDate}T23:59:59.999Z`)),
				),
			);
	},
	async fetchExistingAbsences({ organizationId, employeeIds, startDate, endDate }) {
		if (employeeIds.length === 0) return [];

		return db
			.select({ employeeId: absenceEntry.employeeId, startDate: absenceEntry.startDate, endDate: absenceEntry.endDate })
			.from(absenceEntry)
			.where(
				and(
					eq(absenceEntry.organizationId, organizationId),
					inArray(absenceEntry.employeeId, employeeIds),
					gte(absenceEntry.startDate, startDate),
					lte(absenceEntry.endDate, endDate),
				),
			);
	},
	async getTimeEntryChainState(employeeId) {
		const existing = await db.query.timeEntry.findFirst({
			where: eq(timeEntry.employeeId, employeeId),
			orderBy: (table, { desc }) => desc(table.createdAt),
		});

		return {
			previousHash: existing?.hash ?? null,
			previousEntryId: existing?.id ?? null,
		};
	},
	async insertTimeEntry(input) {
		const [inserted] = await db.insert(timeEntry).values(input).returning({
			id: timeEntry.id,
			hash: timeEntry.hash,
		});

		return inserted;
	},
	async insertWorkPeriod(input) {
		await db.insert(workPeriod).values(input);
	},
	async ensureAbsenceCategory(input) {
		const existing = await db.query.absenceCategory.findFirst({
			where: and(
				eq(absenceCategory.organizationId, input.organizationId),
				eq(absenceCategory.name, input.name),
			),
		});

		if (existing) return existing.id;

		const [inserted] = await db
			.insert(absenceCategory)
			.values({
				organizationId: input.organizationId,
				name: input.name,
				type: input.type,
				countsAgainstVacation: input.countsAgainstVacation,
				requiresApproval: false,
				isActive: true,
			})
			.returning({ id: absenceCategory.id });

		return inserted.id;
	},
	async insertAbsence(input) {
		await db.insert(absenceEntry).values(input);
	},
};

export async function orchestrateClockinImport(
	client: ClockinClient,
	organizationId: string,
	createdBy: string,
	selections: ClockinImportSelections,
	mappings: ClockinImportUserMapping[],
	deps: ClockinImportDependencies = defaultDependencies,
): Promise<ClockinImportResult> {
	const startedAt = Date.now();
	const result: ClockinImportResult = {
		workdays: emptyResult(),
		absences: emptyResult(),
		schedules: emptyResult(),
		status: "success",
		durationMs: 0,
	};

	const mappedEmployees = mappings.filter((entry) => entry.employeeId);
	const employeeIds = mappedEmployees.map((entry) => entry.employeeId!);
	const employeeIdByClockinId = new Map(mappedEmployees.map((entry) => [entry.clockinEmployeeId, entry.employeeId!]));

	try {
		if (selections.workdays) {
			const importedWorkdays = await client.searchWorkdays({
				employeeIds: mappedEmployees.map((entry) => entry.clockinEmployeeId),
				startDate: selections.dateRange.startDate,
				endDate: selections.dateRange.endDate,
			});
			const existingWorkPeriods = await deps.fetchExistingWorkPeriods({
				organizationId,
				employeeIds,
				startDate: selections.dateRange.startDate,
				endDate: selections.dateRange.endDate,
			});
			const chainStateByEmployee = new Map<string, TimeEntryChainState>();

			for (const workday of importedWorkdays) {
				const employeeId = employeeIdByClockinId.get(workday.employee_id);
				if (!employeeId || !workday.starts_at) {
					result.workdays.skipped++;
					continue;
				}

				const mapped: ClockinMappedWorkday = {
					employeeId,
					startAt: workday.starts_at,
					endAt: workday.ends_at,
				};

				if (existingWorkPeriods.some((entry) => isClockinWorkdayDuplicate(mapped, entry))) {
					result.workdays.skipped++;
					continue;
				}

				try {
					const currentState =
						chainStateByEmployee.get(employeeId) ??
						(await deps.getTimeEntryChainState(employeeId));

					const startAt = DateTime.fromISO(workday.starts_at).toUTC();
					const endAt = workday.ends_at ? DateTime.fromISO(workday.ends_at).toUTC() : null;
					const clockInHash = calculateHash({
						employeeId,
						type: "clock_in",
						timestamp: startAt.toISO()!,
						previousHash: currentState.previousHash,
					});

					const insertedClockIn = await deps.insertTimeEntry({
						employeeId,
						organizationId,
						type: "clock_in",
						timestamp: startAt.toJSDate(),
						hash: clockInHash,
						previousHash: currentState.previousHash,
						previousEntryId: currentState.previousEntryId,
						createdBy,
						notes: null,
					});

					let latestState: TimeEntryChainState = {
						previousHash: insertedClockIn.hash,
						previousEntryId: insertedClockIn.id,
					};

					let clockOutId: string | null = null;
					if (endAt) {
						const clockOutHash = calculateHash({
							employeeId,
							type: "clock_out",
							timestamp: endAt.toISO()!,
							previousHash: latestState.previousHash,
						});

						const insertedClockOut = await deps.insertTimeEntry({
							employeeId,
							organizationId,
							type: "clock_out",
							timestamp: endAt.toJSDate(),
							hash: clockOutHash,
							previousHash: latestState.previousHash,
							previousEntryId: latestState.previousEntryId,
							createdBy,
							notes: null,
						});

						clockOutId = insertedClockOut.id;
						latestState = {
							previousHash: insertedClockOut.hash,
							previousEntryId: insertedClockOut.id,
						};
					}

					await deps.insertWorkPeriod({
						employeeId,
						organizationId,
						clockInId: insertedClockIn.id,
						clockOutId,
						startTime: startAt.toJSDate(),
						endTime: endAt?.toJSDate() ?? null,
						durationMinutes:
							endAt ? Math.round(endAt.diff(startAt, "minutes").minutes) : null,
						isActive: !endAt,
					});

					chainStateByEmployee.set(employeeId, latestState);
					result.workdays.imported++;
				} catch (error) {
					result.workdays.errors.push(
						`Workday ${workday.date} for employee ${employeeId}: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			}
		}

		if (selections.absences) {
			const importedAbsences = await client.searchAbsences({
				employeeIds: mappedEmployees.map((entry) => entry.clockinEmployeeId),
				startDate: selections.dateRange.startDate,
				endDate: selections.dateRange.endDate,
			});
			const existingAbsences = await deps.fetchExistingAbsences({
				organizationId,
				employeeIds,
				startDate: selections.dateRange.startDate,
				endDate: selections.dateRange.endDate,
			});

			for (const absence of importedAbsences) {
				const employeeId = employeeIdByClockinId.get(absence.employee_id);
				if (!employeeId) {
					result.absences.skipped++;
					continue;
				}

				const mapped: ClockinMappedAbsence = {
					employeeId,
					startDate: DateTime.fromISO(absence.starts_at).toISODate()!,
					endDate: DateTime.fromISO(absence.ends_at).toISODate()!,
				};

				if (existingAbsences.some((entry) => isClockinAbsenceDuplicate(mapped, entry))) {
					result.absences.skipped++;
					continue;
				}

				try {
					const category = mapAbsenceCategory(absence.absencecategory_name);
					const categoryId = await deps.ensureAbsenceCategory({
						organizationId,
						name: category.name,
						type: category.type,
						countsAgainstVacation: category.countsAgainstVacation,
					});

					await deps.insertAbsence({
						employeeId,
						organizationId,
						categoryId,
						startDate: mapped.startDate,
						endDate: mapped.endDate,
						status: "approved",
						notes: absence.note,
					});
					result.absences.imported++;
				} catch (error) {
					result.absences.errors.push(
						`Absence ${absence.id} for employee ${employeeId}: ${error instanceof Error ? error.message : "Unknown error"}`,
					);
				}
			}
		}

		const hasErrors = [result.workdays, result.absences, result.schedules].some(
			(entry) => entry.errors.length > 0,
		);
		const hasImports = [result.workdays, result.absences].some((entry) => entry.imported > 0);
		result.status = hasErrors ? (hasImports ? "partial" : "failed") : "success";
	} catch (error) {
		result.status = "failed";
		result.errorMessage = error instanceof Error ? error.message : "Clockin import failed";
	}

	result.durationMs = Date.now() - startedAt;
	return result;
}
