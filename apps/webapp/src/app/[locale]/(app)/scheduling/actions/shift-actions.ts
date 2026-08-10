"use server";

import { Effect } from "effect";
import { db } from "@/db";
import { dateFromInstant } from "@/lib/datetime/temporal-core";
import { AuthorizationError } from "@/lib/effect/errors";
import { CoverageService } from "@/lib/effect/services/coverage.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	ScheduleComplianceService,
	ScheduleComplianceServiceLive,
} from "@/lib/effect/services/schedule-compliance.service";
import {
	type IncompleteDayInfo,
	type ShiftMetadata,
	ShiftService,
	type ShiftWithRelations,
} from "@/lib/effect/services/shift.service";
import type { ScheduleComplianceSummary } from "@/lib/scheduling/compliance/types";
import {
	resolveScheduleDateRange,
	resolveScheduleWallTime,
} from "@/lib/scheduling/schedule-local-input";
import { parseIanaTimeZone } from "@/lib/timezone/validation";
import { buildPublishDecision } from "../publish-decision";
import type {
	DateRange,
	PublishAcknowledgmentInput,
	PublishShiftsResult,
	Shift,
	ShiftQuery,
	UpsertShiftInput,
} from "../types";
import {
	type CurrentEmployee,
	logger,
	requireCurrentEmployee,
	requireManagerEmployee,
	runSchedulingAction,
	type SchedulingActionResult,
} from "./shared";

function toServiceDateRange(dateRange: DateRange, timezone: string) {
	const range = resolveScheduleDateRange(dateRange, timezone);
	return {
		start: dateFromInstant(range.start),
		endExclusive: dateFromInstant(range.endExclusive),
	};
}

async function getOrganizationTimezone(organizationId: string) {
	const currentOrganization = await db.query.organization.findFirst({
		where: (table, { eq }) => eq(table.id, organizationId),
		columns: { timezone: true },
	});
	return parseIanaTimeZone(currentOrganization?.timezone ?? "UTC");
}

function getEffectiveShiftQuery(
	query: ShiftQuery,
	currentEmployee: Pick<CurrentEmployee, "id" | "organizationId" | "role">,
	userId: string,
	timezone: string,
) {
	const { startDate, endDateExclusive, ...filters } = query;
	const range =
		startDate && endDateExclusive
			? toServiceDateRange({ startDate, endDateExclusive }, timezone)
			: undefined;
	const effectiveQuery = {
		...filters,
		...range,
		organizationId: currentEmployee.organizationId,
	};

	if (currentEmployee.role !== "employee") {
		return Effect.succeed(effectiveQuery);
	}

	if (query.employeeId && query.employeeId !== currentEmployee.id) {
		return Effect.fail(
			new AuthorizationError({
				message: "You can only view your own shifts",
				userId,
				resource: "shift",
				action: "read",
			}),
		);
	}

	return Effect.succeed({
		...effectiveQuery,
		employeeId: currentEmployee.id,
		status: "published" as const,
	});
}

function getScheduleComplianceEvaluation(
	dateRange: DateRange,
	context: Pick<CurrentEmployee, "organizationId"> & {
		session: { user: { id: string } };
	},
) {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const scheduleComplianceService = yield* _(ScheduleComplianceService);

		const timezone = yield* _(
			dbService.query(
				"getOrganizationTimezoneForScheduleCompliance",
				async () => getOrganizationTimezone(context.organizationId),
			),
		);
		const range = toServiceDateRange(dateRange, timezone);

		const evaluation = yield* _(
			scheduleComplianceService.evaluateScheduleWindow({
				organizationId: context.organizationId,
				startDate: range.start,
				endDate: range.endExclusive,
				timezone,
			}),
		);

		return { evaluation };
	});
}

export async function upsertShift(
	input: UpsertShiftInput,
): Promise<SchedulingActionResult<{ shift: Shift; metadata: ShiftMetadata }>> {
	const effect = Effect.gen(function* (_) {
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);
		const { currentEmployee, session } = yield* _(
			requireManagerEmployee({
				resource: "shift",
				action: input.id ? "update" : "create",
				message: "Only managers and admins can manage shifts",
			}),
		);
		const timezone = yield* _(
			dbService.query("getOrganizationTimezoneForUpsertShift", async () =>
				getOrganizationTimezone(currentEmployee.organizationId),
			),
		);
		const shiftDate = dateFromInstant(
			resolveScheduleWallTime(
				{ date: input.date, time: "00:00" },
				timezone,
			).toInstant(),
		);
		resolveScheduleWallTime(
			{ date: input.date, time: input.startTime },
			timezone,
		);
		resolveScheduleWallTime(
			{ date: input.date, time: input.endTime },
			timezone,
		);

		return yield* _(
			shiftService.upsertShift({
				id: input.id,
				organizationId: currentEmployee.organizationId,
				employeeId: input.employeeId,
				templateId: input.templateId,
				subareaId: input.subareaId,
				date: shiftDate,
				timezone,
				startTime: input.startTime,
				endTime: input.endTime,
				notes: input.notes,
				color: input.color,
				createdBy: session.user.id,
			}),
		);
	});

	return runSchedulingAction("upsertShift", effect);
}

export async function deleteShift(
	id: string,
): Promise<SchedulingActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const shiftService = yield* _(ShiftService);
		const { currentEmployee, session } = yield* _(
			requireManagerEmployee({
				resource: "shift",
				action: "delete",
				message: "Only managers and admins can delete shifts",
			}),
		);

		yield* _(
			shiftService.deleteShift(id, {
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				userId: session.user.id,
			}),
		);
	});

	return runSchedulingAction("deleteShift", effect);
}

export async function getShifts(
	query: ShiftQuery,
): Promise<SchedulingActionResult<ShiftWithRelations[]>> {
	const effect = Effect.gen(function* (_) {
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);
		const { currentEmployee, session } = yield* _(requireCurrentEmployee());
		const timezone = yield* _(
			dbService.query("getOrganizationTimezoneForShifts", async () =>
				getOrganizationTimezone(currentEmployee.organizationId),
			),
		);
		const effectiveQuery = yield* _(
			getEffectiveShiftQuery(query, currentEmployee, session.user.id, timezone),
		);

		return yield* _(shiftService.getShifts(effectiveQuery));
	});

	return runSchedulingAction("getShifts", effect);
}

export async function publishShifts(
	dateRange: DateRange,
	acknowledgment?: PublishAcknowledgmentInput | null,
): Promise<SchedulingActionResult<PublishShiftsResult>> {
	const effect = Effect.gen(function* (_) {
		const coverageService = yield* _(CoverageService);
		const scheduleComplianceService = yield* _(ScheduleComplianceService);
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);
		const { currentEmployee, session } = yield* _(
			requireManagerEmployee({
				resource: "shift",
				action: "publish",
				message: "Only managers and admins can publish shifts",
			}),
		);
		const timezone = yield* _(
			dbService.query("getOrganizationTimezoneForPublish", async () =>
				getOrganizationTimezone(currentEmployee.organizationId),
			),
		);
		const serviceDateRange = toServiceDateRange(dateRange, timezone);

		const settings = yield* _(
			coverageService.getCoverageSettings(currentEmployee.organizationId),
		);

		if (!settings.allowPublishWithGaps) {
			const validation = yield* _(
				coverageService.validateScheduleCanPublish({
					organizationId: currentEmployee.organizationId,
					startDate: serviceDateRange.start,
					endDate: serviceDateRange.endExclusive,
					timezone,
				}),
			);

			if (!validation.canPublish) {
				return yield* _(
					Effect.fail(
						new AuthorizationError({
							message: `Cannot publish: ${validation.gaps.length} coverage gap(s) detected. Review and fill gaps before publishing.`,
							userId: session.user.id,
							resource: "shift",
							action: "publish",
						}),
					),
				);
			}
		}

		const { evaluation } = yield* _(
			getScheduleComplianceEvaluation(dateRange, {
				organizationId: currentEmployee.organizationId,
				session,
			}),
		);
		const publishDecision = buildPublishDecision({
			count: 0,
			compliance: {
				summary: evaluation.summary,
				fingerprint: evaluation.fingerprint,
			},
			acknowledgment,
		});

		if (!publishDecision.published) {
			return publishDecision;
		}

		const result = yield* _(
			shiftService.publishShifts(
				currentEmployee.organizationId,
				serviceDateRange,
				session.user.id,
			),
		);

		if (evaluation.summary.totalFindings > 0) {
			yield* _(
				scheduleComplianceService.recordPublishAcknowledgment({
					organizationId: currentEmployee.organizationId,
					actorEmployeeId: currentEmployee.id,
					publishedRangeStart: serviceDateRange.start,
					publishedRangeEnd: serviceDateRange.endExclusive,
					warningCountTotal: evaluation.summary.totalFindings,
					warningCountsByType: evaluation.summary.byType,
					evaluationFingerprint: evaluation.fingerprint,
				}),
			);
		}

		logger.info(
			{
				count: result.count,
				affectedEmployees: result.affectedEmployeeIds.length,
			},
			"Published shifts",
		);

		return {
			published: true as const,
			requiresAcknowledgment: false as const,
			count: result.count,
		};
	}).pipe(Effect.provide(ScheduleComplianceServiceLive));

	return runSchedulingAction("publishShifts", effect);
}

export async function getIncompleteDays(
	dateRange: DateRange,
): Promise<SchedulingActionResult<IncompleteDayInfo[]>> {
	const effect = Effect.gen(function* (_) {
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);
		const { currentEmployee } = yield* _(requireCurrentEmployee());

		const timezone = yield* _(
			dbService.query("getOrganizationTimezoneForIncompleteDays", async () =>
				getOrganizationTimezone(currentEmployee.organizationId),
			),
		);
		return yield* _(
			shiftService.getIncompleteDays(
				currentEmployee.organizationId,
				toServiceDateRange(dateRange, timezone),
				timezone,
			),
		);
	});

	return runSchedulingAction("getIncompleteDays", effect);
}

export async function getScheduleComplianceSummary(
	dateRange: DateRange,
): Promise<
	SchedulingActionResult<{
		summary: ScheduleComplianceSummary;
		evaluationFingerprint: string;
	}>
> {
	const effect = Effect.gen(function* (_) {
		const { currentEmployee, session } = yield* _(
			requireManagerEmployee({
				resource: "shift",
				action: "read",
				message:
					"Only managers and admins can view schedule compliance warnings",
				queryName: "getCurrentEmployeeForScheduleComplianceSummary",
			}),
		);
		const { evaluation } = yield* _(
			getScheduleComplianceEvaluation(dateRange, {
				organizationId: currentEmployee.organizationId,
				session,
			}),
		);

		return {
			summary: evaluation.summary,
			evaluationFingerprint: evaluation.fingerprint,
		};
	}).pipe(Effect.provide(ScheduleComplianceServiceLive));

	return runSchedulingAction("getScheduleComplianceSummary", effect);
}

export async function getOpenShifts(
	dateRange: DateRange,
): Promise<SchedulingActionResult<ShiftWithRelations[]>> {
	const effect = Effect.gen(function* (_) {
		const shiftService = yield* _(ShiftService);
		const dbService = yield* _(DatabaseService);
		const { currentEmployee } = yield* _(requireCurrentEmployee());
		const timezone = yield* _(
			dbService.query("getOrganizationTimezoneForOpenShifts", async () =>
				getOrganizationTimezone(currentEmployee.organizationId),
			),
		);
		const range = toServiceDateRange(dateRange, timezone);

		const shifts = yield* _(
			shiftService.getShifts({
				organizationId: currentEmployee.organizationId,
				startDate: range.start,
				endDateExclusive: range.endExclusive,
				status: "published",
				includeOpenShifts: true,
			}),
		);

		return shifts.filter((shift) => shift.employeeId === null);
	});

	return runSchedulingAction("getOpenShifts", effect);
}
