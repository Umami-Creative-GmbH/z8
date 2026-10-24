import "server-only";
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { absenceEntry, type employee, holiday, holidayCategory, userSettings } from "@/db/schema";
import { getAbsenceDaysByAbsenceId } from "@/lib/absences/absence-days-resolver";
import { loadCoverDuties, loadDeputyViewerForEmployee } from "@/lib/absences/deputy-display-store";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	type PlainDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import {
	type EffectiveWorkPolicy,
	WorkPolicyService,
} from "@/lib/effect/services/work-policy.service";
import { loadUpcomingShifts, UPCOMING_SHIFTS_LIMIT } from "@/lib/scheduling/upcoming-shifts";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { resolvePersonalTimezone } from "@/lib/timezone/resolve-timezone";
import { currentRosterEmployeeIds } from "./current-roster-queries";
import type { DashboardSubject, UpcomingTimeOffData } from "./dashboard-types";
import { type AbsenceRange, getNextAvailableReturnDate } from "./return-date-calculations";

type DashboardTodayAbsenceRow = typeof absenceEntry.$inferSelect & {
	employee: Pick<typeof employee.$inferSelect, "id"> & {
		user: { id: string; name: string | null; image: string | null };
	};
	category: { name: string; color: string | null };
};

function utcDateBoundary(date: PlainDate) {
	return dateFromInstant(date.toZonedDateTime("UTC").toInstant());
}

export function loadUpcomingAbsencesForOrganization(
	organizationId: string,
	limit = 5,
	now: Instant = systemClock.nowInstant(),
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		// Get today's date as YYYY-MM-DD string for absence date comparison
		const timezone = yield* dbService.query("dashboard.organizationTimezone", () =>
			loadOrganizationTimezone(dbService.db, organizationId),
		);
		const todayStr = plainDateAt(now, timezone).toString();

		// Upcoming time off is the current roster's (#1438).
		const orgEmployeeIds = yield* dbService.query("dashboard.upcomingAbsences.currentRoster", () =>
			currentRosterEmployeeIds(dbService.db, organizationId),
		);

		// Get upcoming absences (approved, starting from today)
		const absences = yield* dbService.query("getUpcomingAbsences", async () => {
			if (orgEmployeeIds.length === 0) return [];
			return await dbService.db.query.absenceEntry.findMany({
				where: and(
					inArray(absenceEntry.employeeId, orgEmployeeIds),
					eq(absenceEntry.organizationId, organizationId),
					eq(absenceEntry.status, "approved"),
					gte(absenceEntry.startDate, todayStr),
				),
				orderBy: (absenceEntry, { asc }) => [asc(absenceEntry.startDate)],
				limit,
				with: {
					employee: {
						with: {
							user: {
								columns: {
									id: true,
									name: true,
									image: true,
								},
							},
						},
					},
					category: {
						columns: {
							name: true,
							color: true,
						},
					},
				},
			});
		});

		return absences;
	});
}

/** Holidays excluded from calculations that may fall into the return-date search. */
async function loadReturnDateHolidayRows(
	db: DatabaseClient,
	organizationId: string,
	searchStart: Date,
	searchEnd: Date,
) {
	return await db
		.select({
			startDate: holiday.startDate,
			endDate: holiday.endDate,
			recurrenceType: holiday.recurrenceType,
			recurrenceRule: holiday.recurrenceRule,
			recurrenceEndDate: holiday.recurrenceEndDate,
		})
		.from(holiday)
		.innerJoin(holidayCategory, eq(holiday.categoryId, holidayCategory.id))
		.where(
			and(
				eq(holiday.organizationId, organizationId),
				eq(holiday.isActive, true),
				eq(holidayCategory.isActive, true),
				eq(holidayCategory.excludeFromCalculations, true),
				or(
					eq(holiday.recurrenceType, "yearly"),
					and(
						eq(holiday.recurrenceType, "none"),
						lte(holiday.startDate, searchEnd),
						gte(holiday.endDate, searchStart),
					),
				),
			),
		);
}

export function loadWhosOutForOrganization(
	organizationId: string,
	now: Instant = systemClock.nowInstant(),
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const workPolicyService = yield* WorkPolicyService;

		// Get today's date as YYYY-MM-DD string
		const timezone = yield* dbService.query("dashboard.organizationTimezone", () =>
			loadOrganizationTimezone(dbService.db, organizationId),
		);
		const today = plainDateAt(now, timezone);
		const todayStr = today.toString();
		const returnSearchStart = today.add({ days: 1 });
		const returnSearchEnd = today.add({ days: 366 });
		// Who's out is the current roster's absences (#1438).
		const orgEmployeeIds = yield* dbService.query("dashboard.whosOutToday.currentRoster", () =>
			currentRosterEmployeeIds(dbService.db, organizationId),
		);

		// Get absences that overlap with today
		const todayAbsences = yield* dbService.query("getTodayAbsences", async () => {
			if (orgEmployeeIds.length === 0) return [];
			return await dbService.db.query.absenceEntry.findMany({
				where: and(
					inArray(absenceEntry.employeeId, orgEmployeeIds),
					eq(absenceEntry.organizationId, organizationId),
					eq(absenceEntry.status, "approved"),
					lte(absenceEntry.startDate, todayStr),
					gte(absenceEntry.endDate, todayStr),
				),
				with: {
					employee: {
						with: {
							user: {
								columns: {
									id: true,
									name: true,
									image: true,
								},
							},
						},
					},
					category: {
						columns: {
							name: true,
							color: true,
						},
					},
				},
			});
		});

		// Process absences - deduplicate by employee ID (employee may have multiple overlapping absences)
		const outTodayMap = new Map<
			string,
			{
				id: string;
				userId: string;
				name: string;
				image: string | null;
				category: string;
				categoryColor: string | null;
				endsToday: boolean;
				returnsTomorrow: boolean;
				returnDate: string;
			}
		>();

		const returningTomorrowMap = new Map<
			string,
			{
				id: string;
				userId: string;
				name: string;
				image: string | null;
				category: string;
				categoryColor: string | null;
				endsToday: boolean;
				returnsTomorrow: boolean;
				returnDate: string;
			}
		>();

		const typedTodayAbsences = todayAbsences as unknown as DashboardTodayAbsenceRow[];
		const futureAbsences = yield* dbService.query("getReturnDateAbsences", async () => {
			if (orgEmployeeIds.length === 0) return [];
			return await dbService.db.query.absenceEntry.findMany({
				where: and(
					inArray(absenceEntry.employeeId, orgEmployeeIds),
					eq(absenceEntry.organizationId, organizationId),
					eq(absenceEntry.status, "approved"),
					gte(absenceEntry.endDate, returnSearchStart.toString()),
					lte(absenceEntry.startDate, returnSearchEnd.toString()),
				),
				columns: {
					employeeId: true,
					startDate: true,
					endDate: true,
				},
			});
		});
		const absenceRangesByEmployee = new Map<string, AbsenceRange[]>();
		for (const absence of futureAbsences) {
			const ranges = absenceRangesByEmployee.get(absence.employeeId) ?? [];
			ranges.push({ startDate: absence.startDate, endDate: absence.endDate });
			absenceRangesByEmployee.set(absence.employeeId, ranges);
		}

		const holidayRows = yield* dbService.query("getReturnDateHolidays", () =>
			loadReturnDateHolidayRows(
				dbService.db,
				organizationId,
				utcDateBoundary(returnSearchStart),
				utcDateBoundary(returnSearchEnd.add({ days: 1 })),
			),
		);

		const holidayDates = new Set<string>();
		for (const row of holidayRows) {
			if (row.recurrenceType === "yearly") {
				if (!row.recurrenceRule) continue;
				try {
					const rule = JSON.parse(row.recurrenceRule) as { month?: number; day?: number };
					if (!rule.month || !rule.day) continue;
					for (let year = returnSearchStart.year; year <= returnSearchEnd.year; year++) {
						try {
							const instance = Temporal.PlainDate.from(
								{ year, month: rule.month, day: rule.day },
								{ overflow: "reject" },
							);
							if (
								Temporal.PlainDate.compare(instance, returnSearchStart) < 0 ||
								Temporal.PlainDate.compare(instance, returnSearchEnd) > 0
							)
								continue;
							if (
								row.recurrenceEndDate &&
								Temporal.PlainDate.compare(
									instance,
									plainDateAt(instantFromDate(row.recurrenceEndDate), "UTC"),
								) > 0
							)
								continue;
							holidayDates.add(instance.toString());
						} catch {
							// A recurrence such as February 29 has no instance in a non-leap year.
						}
					}
				} catch {
					continue;
				}
				continue;
			}
			let current = plainDateAt(instantFromDate(row.startDate), "UTC");
			const last = plainDateAt(instantFromDate(row.endDate), "UTC");
			while (
				Temporal.PlainDate.compare(current, last) <= 0 &&
				Temporal.PlainDate.compare(current, returnSearchEnd) <= 0
			) {
				if (Temporal.PlainDate.compare(current, returnSearchStart) >= 0)
					holidayDates.add(current.toString());
				current = current.add({ days: 1 });
			}
		}

		const schedulesByEmployee = new Map<string, EffectiveWorkPolicy | null>();
		for (const employeeId of new Set(typedTodayAbsences.map((absence) => absence.employee.id))) {
			const policy = yield* workPolicyService
				.getEffectivePolicy(employeeId)
				.pipe(Effect.catch(() => Effect.succeed(null)));
			schedulesByEmployee.set(employeeId, policy);
		}

		for (const absence of typedTodayAbsences) {
			const employeeId = absence.employee.id;
			const endsToday = absence.endDate === todayStr;
			const returnInfo = getNextAvailableReturnDate({
				absenceEndDate: absence.endDate,
				today: todayStr,
				schedule: schedulesByEmployee.get(employeeId)?.schedule ?? null,
				holidayDates,
				absenceRanges: absenceRangesByEmployee.get(employeeId) ?? [],
			});
			const returnsTomorrow = returnInfo.returnsTomorrow;
			const returnDate = returnInfo.returnDate;

			const employeeData = {
				id: employeeId,
				userId: absence.employee.user.id,
				name: absence.employee.user.name || "Unknown",
				image: absence.employee.user.image,
				category: absence.category.name,
				categoryColor: absence.category.color,
				endsToday,
				returnsTomorrow,
				returnDate,
			};

			// Only add if not already present (first absence wins)
			if (!outTodayMap.has(employeeId)) {
				outTodayMap.set(employeeId, employeeData);
			}

			if (endsToday && returnsTomorrow && !returningTomorrowMap.has(employeeId)) {
				returningTomorrowMap.set(employeeId, employeeData);
			}
		}

		const outToday = Array.from(outTodayMap.values());
		const returningTomorrow = Array.from(returningTomorrowMap.values());

		// Sort by name
		outToday.sort((a, b) => a.name.localeCompare(b.name));
		returningTomorrow.sort((a, b) => a.name.localeCompare(b.name));

		return {
			outToday,
			returningTomorrow,
			totalOut: outToday.length,
		};
	});
}

export function loadUpcomingTimeOffForOrganization(organizationId: string) {
	return Effect.gen(function* () {
		const now = systemClock.nowInstant();
		const dbService = yield* DatabaseService;
		const rows = yield* loadUpcomingAbsencesForOrganization(organizationId, 5, now);
		const [days, timezone, settings] = yield* dbService.query(
			"dashboard.upcomingAbsences.display",
			() =>
				Promise.all([
					getAbsenceDaysByAbsenceId(dbService.db, { organizationId, absences: rows }),
					loadOrganizationTimezone(dbService.db, organizationId),
					rows.length
						? dbService.db
								.select({ userId: userSettings.userId, timezone: userSettings.timezone })
								.from(userSettings)
								.where(
									inArray(
										userSettings.userId,
										rows.map((row) => row.employee.user.id),
									),
								)
						: Promise.resolve([]),
				]),
		);
		const zones = new Map(settings.map((setting) => [setting.userId, setting.timezone]));
		return rows.map((row): UpcomingTimeOffData[number] => {
			const absenceDays = days.get(row.id);
			if (absenceDays === undefined) throw new Error("Absence days could not be resolved");
			return {
				id: row.id,
				startDate: row.startDate,
				endDate: row.endDate,
				absenceDays,
				daysUntil: Temporal.PlainDate.from(row.startDate).since(
					plainDateAt(
						now,
						resolvePersonalTimezone({
							userTimezone: zones.get(row.employee.user.id),
							organizationTimezone: timezone,
						}).timezone,
					),
				).days,
				employee: {
					id: row.employee.id,
					user: {
						id: row.employee.user.id,
						name: row.employee.user.name,
						image: row.employee.user.image,
					},
				},
				category: { name: row.category.name, color: row.category.color },
			};
		});
	});
}

export function loadUpcomingShiftsForEmployee(employee: NonNullable<DashboardSubject["employee"]>) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query("dashboard.upcomingShifts", async () => {
			const [settings] = await dbService.db
				.select({ enabled: organization.shiftsEnabled })
				.from(organization)
				.where(eq(organization.id, employee.organizationId))
				.limit(1);
			if (!settings?.enabled) return null;
			return loadUpcomingShifts(dbService.db, {
				organizationId: employee.organizationId,
				employeeId: employee.id,
				organizationTimezone: await loadOrganizationTimezone(dbService.db, employee.organizationId),
				now: systemClock.nowInstant(),
				limit: UPCOMING_SHIFTS_LIMIT,
			});
		});
	});
}

export async function loadCoverDutiesForSubject(subject: DashboardSubject) {
	if (!subject.employee) throw new Error("Employee access required");
	const viewer = await loadDeputyViewerForEmployee(db, {
		organizationId: subject.organizationId,
		userId: subject.userId,
		employee: subject.employee,
	});
	const duties = await loadCoverDuties(db, {
		organizationId: subject.organizationId,
		viewer,
		now: systemClock.nowInstant(),
	});
	return { ...duties, viewerRole: viewer.role };
}
