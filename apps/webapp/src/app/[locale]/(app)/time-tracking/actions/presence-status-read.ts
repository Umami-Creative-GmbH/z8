import "server-only";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { absenceCategory, absenceEntry, userSettings, workPeriod } from "@/db/schema";
import {
	loadEffectiveContractsBatch,
	resolveEffectiveContractOnDay,
} from "@/lib/contracts/resolve-contract";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { normalizeWeekStartDay, type WeekStartDay } from "@/lib/user-preferences/week-start";
import {
	calculatePresenceStatusSummary,
	expandApprovedHomeOfficeDates,
	getPresencePeriodBounds,
	getPresenceWorkDays,
	type PresenceDayOfWeek,
	type PresenceEvaluationPeriod,
	type PresenceStatusSummary,
	validatePresenceFixedDaysConfig,
} from "./presence-status";

/** Caller owns employee authorization. Public actions reauthorize; Dashboard uses its trusted self. */
export function loadPresenceStatusForSubject(subject: {
	userId: string;
	organizationId: string;
	employeeId: string;
	preferences?: { weekStartDay: WeekStartDay; timezone: string };
	now?: DateTime;
}) {
	const disabledPresenceStatus = (message: string): PresenceStatusSummary => ({
		presenceEnabled: false,
		available: false,
		period: "weekly",
		periodStart: "",
		periodEnd: "",
		mode: "minimum_count",
		homeOfficeDaysLeft: 0,
		officeDaysRequiredLeft: 0,
		officeDaysCompleted: 0,
		homeOfficeDaysUsed: 0,
		workingDaysRemaining: 0,
		requiredOfficeDays: 0,
		fixedOfficeDays: [],
		message,
	});
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const now = subject.now ?? DateTime.now();
		const settingsData =
			subject.preferences ??
			(yield* dbService.query("getPresencePreferences", () =>
				dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, subject.userId),
					columns: { timezone: true, weekStartDay: true },
				}),
			));
		const weekStartDay = normalizeWeekStartDay(settingsData?.weekStartDay);
		const timezone = settingsData?.timezone || "UTC";
		const todayStr = now.setZone(timezone).toISODate() ?? now.toUTC().toISODate()!;

		// Resolve today's effective contract through the unified read-only resolver.
		const todayContract = yield* dbService.query("resolvePresenceContractToday", () =>
			resolveEffectiveContractOnDay(dbService.db, {
				organizationId: subject.organizationId,
				employeeId: subject.employeeId,
				date: todayStr,
				timezoneOverride: timezone,
			}),
		);

		if (!todayContract?.workPolicy) {
			return disabledPresenceStatus("No effective work policy found.");
		}

		if (
			todayContract.presenceStatus === "not_configured" ||
			!todayContract.workPolicy.presenceEnabled ||
			!todayContract.workPolicy.presence
		) {
			return disabledPresenceStatus("Presence policy is not enabled.");
		}

		const presenceConfig = todayContract.workPolicy.presence;
		const { start: periodStart, end: periodEnd } = getPresencePeriodBounds({
			period: presenceConfig.evaluationPeriod,
			now,
			weekStartDay,
			timezone,
		});
		const periodStartDate = periodStart.toISODate() ?? todayStr;
		const periodEndDate = periodEnd.toISODate() ?? todayStr;

		// Resolve every day in the evaluation period so midweek remote/exempt changes are honored.
		const periodDates: string[] = [];
		for (
			let cursor = periodStart.startOf("day");
			cursor <= periodEnd;
			cursor = cursor.plus({ days: 1 })
		) {
			const iso = cursor.toISODate();
			if (iso && iso <= periodEndDate) {
				periodDates.push(iso);
			}
		}

		const periodContracts =
			(yield* dbService.query("resolvePresenceContractsPeriod", () =>
				loadEffectiveContractsBatch(dbService.db, {
					organizationId: subject.organizationId,
					employeeIds: [subject.employeeId],
					dates: periodDates,
					timezoneOverride: timezone,
				}),
			)).get(subject.employeeId) ?? new Map();

		const exemptDates: string[] = [];
		let anyRequiredDayInPeriod = false;
		for (const dateKey of periodDates) {
			const dayContract = periodContracts.get(dateKey);
			if (!dayContract || dayContract.presenceStatus !== "required") {
				exemptDates.push(dateKey);
			} else {
				anyRequiredDayInPeriod = true;
			}
		}

		if (!anyRequiredDayInPeriod) {
			return disabledPresenceStatus("Presence policy is exempt for this period.");
		}

		const fixedOfficeDays = presenceConfig.requiredOnsiteFixedDays
			? ([...presenceConfig.requiredOnsiteFixedDays] as PresenceDayOfWeek[])
			: null;

		const fixedDaysConfigMessage = validatePresenceFixedDaysConfig(
			presenceConfig.presenceMode,
			fixedOfficeDays,
		);
		if (fixedDaysConfigMessage) {
			return {
				presenceEnabled: true,
				available: false,
				period: presenceConfig.evaluationPeriod as PresenceEvaluationPeriod,
				periodStart: periodStart.toISO() ?? "",
				periodEnd: periodEnd.toISO() ?? "",
				mode: presenceConfig.presenceMode,
				homeOfficeDaysLeft: 0,
				officeDaysRequiredLeft: 0,
				officeDaysCompleted: 0,
				homeOfficeDaysUsed: 0,
				workingDaysRemaining: 0,
				requiredOfficeDays: 0,
				fixedOfficeDays: [],
				message: fixedDaysConfigMessage,
			};
		}

		const periods = yield* dbService.query("getPresenceWorkPeriods", async () => {
			return await dbService.db.query.workPeriod.findMany({
				where: and(
					eq(workPeriod.employeeId, subject.employeeId),
					eq(workPeriod.organizationId, subject.organizationId),
					isNull(workPeriod.deletedAt),
					gte(workPeriod.startTime, periodStart.toJSDate()),
					lte(workPeriod.startTime, periodEnd.toJSDate()),
				),
				columns: { startTime: true, workLocationType: true },
			});
		});

		const approvedHomeOfficeEntries = yield* dbService.query(
			"getApprovedHomeOfficeEntries",
			async () => {
				return await dbService.db
					.select({
						startDate: absenceEntry.startDate,
						endDate: absenceEntry.endDate,
					})
					.from(absenceEntry)
					.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
					.where(
						and(
							eq(absenceEntry.employeeId, subject.employeeId),
							eq(absenceEntry.organizationId, subject.organizationId),
							eq(absenceEntry.status, "approved"),
							eq(absenceCategory.organizationId, subject.organizationId),
							eq(absenceCategory.type, "home_office"),
							lte(absenceEntry.startDate, periodEndDate),
							gte(absenceEntry.endDate, periodStartDate),
						),
					);
			},
		);

		const approvedHomeOfficeDates = expandApprovedHomeOfficeDates({
			entries: approvedHomeOfficeEntries,
			periodStart,
			periodEnd,
			timezone,
		});

		const scheduleDays = todayContract.weeklyScheduleDays.some((d) => d.isWorkDay)
			? todayContract.weeklyScheduleDays.map((d) => ({
					dayOfWeek: d.dayOfWeek,
					isWorkDay: d.isWorkDay,
				}))
			: (todayContract.workPolicy.schedule?.days.map((d) => ({
					dayOfWeek: d.dayOfWeek,
					isWorkDay: d.isWorkDay,
				})) ?? null);

		return calculatePresenceStatusSummary({
			presenceMode: presenceConfig.presenceMode,
			requiredOnsiteDays: presenceConfig.requiredOnsiteDays,
			requiredOnsiteFixedDays: fixedOfficeDays,
			period: presenceConfig.evaluationPeriod,
			periodStart,
			periodEnd,
			now,
			timezone,
			workDays: getPresenceWorkDays(scheduleDays),
			workPeriods: periods,
			approvedHomeOfficeDates,
			exemptDates,
		});
	});
}
