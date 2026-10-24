import "server-only";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import {
	absenceCategory,
	absenceEntry,
	userSettings,
	workPeriod,
	workPolicy,
	workPolicyPresence,
} from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { WorkPolicyService } from "@/lib/effect/services/work-policy.service";
import { normalizeWeekStartDay, type WeekStartDay } from "@/lib/user-preferences/week-start";
import {
	calculatePresenceStatusSummary,
	expandApprovedHomeOfficeDates,
	getPresencePeriodBounds,
	getPresenceWorkDays,
	type PresenceEvaluationPeriod,
	type PresenceStatusSummary,
	parsePresenceFixedDays,
	validatePresenceFixedDaysConfig,
} from "./presence-status";

/** Caller owns employee authorization. Public actions reauthorize; Dashboard uses its trusted self. */
export function loadPresenceStatusForSubject(subject: {
	userId: string;
	organizationId: string;
	employeeId: string;
	preferences?: { weekStartDay: WeekStartDay; timezone: string };
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
		// Get employee's effective work policy
		const workPolicyService = yield* WorkPolicyService;
		const effectivePolicy = yield* workPolicyService.getEffectivePolicy(subject.employeeId);

		if (!effectivePolicy) {
			return disabledPresenceStatus("No effective work policy found.");
		}

		// Check if presence is enabled on the policy
		const policyRow = yield* dbService.query("getWorkPolicy", async () => {
			return await dbService.db.query.workPolicy.findFirst({
				where: and(
					eq(workPolicy.id, effectivePolicy.policyId),
					eq(workPolicy.organizationId, subject.organizationId),
				),
				columns: { presenceEnabled: true },
			});
		});

		if (!policyRow?.presenceEnabled) {
			return disabledPresenceStatus("Presence policy is not enabled.");
		}

		// Load presence config
		const presenceConfig = yield* dbService.query("getPresenceConfig", async () => {
			return await dbService.db.query.workPolicyPresence.findFirst({
				where: eq(workPolicyPresence.policyId, effectivePolicy.policyId),
			});
		});

		if (!presenceConfig) {
			return disabledPresenceStatus("Presence policy configuration is missing.");
		}

		const now = DateTime.now();
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
		const { start: periodStart, end: periodEnd } = getPresencePeriodBounds({
			period: presenceConfig.evaluationPeriod,
			now,
			weekStartDay,
			timezone,
		});

		const fixedOfficeDays = presenceConfig.requiredOnsiteFixedDays
			? parsePresenceFixedDays(presenceConfig.requiredOnsiteFixedDays)
			: null;

		if (presenceConfig.requiredOnsiteFixedDays && fixedOfficeDays === null) {
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
				message: "Presence policy has invalid fixed office days.",
			};
		}

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
		const periodStartDate = periodStart.toISODate() ?? "";
		const periodEndDate = periodEnd.toISODate() ?? "";

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

		return calculatePresenceStatusSummary({
			presenceMode: presenceConfig.presenceMode,
			requiredOnsiteDays: presenceConfig.requiredOnsiteDays,
			requiredOnsiteFixedDays: fixedOfficeDays,
			period: presenceConfig.evaluationPeriod,
			periodStart,
			periodEnd,
			now,
			timezone,
			workDays: getPresenceWorkDays(effectivePolicy.schedule?.days ?? null),
			workPeriods: periods,
			approvedHomeOfficeDates,
		});
	});
}
