/**
 * "Clock Out" Command
 *
 * Allows employees to clock out directly from a bot (Telegram, Teams, etc.).
 * Creates a time entry, updates the work period, and triggers post-clock-out
 * processing (compliance, surcharges, break enforcement).
 */

import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import {
	calculateAndPersistSurcharges,
	checkComplianceAfterClockOut,
	enforceBreaksAfterClockOut,
} from "@/app/[locale]/(app)/time-tracking/actions";
import { db } from "@/db";
import { employee, workPeriod } from "@/db/schema";
import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import {
	ChangePolicyService,
	ChangePolicyServiceLive,
} from "@/lib/effect/services/change-policy.service";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { ClockingConflictError, clockingService } from "@/lib/time-tracking/clocking-service";
import { resolveFallbackTimezoneCapture } from "@/lib/time-tracking/timezone-capture";
import { validateTimeEntry } from "@/lib/time-tracking/validation";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import { getCommandTemporalContext } from "./command-temporal";

const logger = createLogger("BotCommand:ClockOut");

export const clockOutCommand: BotCommand = {
	name: "clockout",
	aliases: ["out", "stop", "aus"],
	description: "bot.cmd.clockout.desc",
	usage: "clockout",
	requiresAuth: true,
	handler: async (ctx: BotCommandContext): Promise<BotCommandResponse> => {
		try {
			const t = await getBotTranslate(ctx.locale);
			const temporal = ctx.temporal ?? getCommandTemporalContext(ctx);

			// Look up employee record for org verification
			const emp = await db.query.employee.findFirst({
				where: and(
					eq(employee.id, ctx.employeeId),
					eq(employee.organizationId, ctx.organizationId),
				),
			});

			if (!emp) {
				return {
					type: "text",
					text: t("bot.cmd.clockout.noProfile", "Employee profile not found."),
				};
			}

			const billingAccess = await requireBillingForMutation(emp.organizationId);
			if (!isBillingMutationAllowed(billingAccess)) {
				return {
					type: "text",
					text: t(
						"bot.cmd.billingRequired",
						"Billing is required to continue using time tracking. Ask an organization admin to update billing.",
					),
				};
			}

			const timezone = temporal.effectiveTimezone;

			// Check for active work period
			const activePeriod = await db.query.workPeriod.findFirst({
				where: and(eq(workPeriod.employeeId, emp.id), isNull(workPeriod.endTime)),
			});

			if (!activePeriod) {
				return {
					type: "text",
					text: t("bot.cmd.clockout.notClockedIn", "You are not currently clocked in."),
				};
			}

			const now = dateFromInstant(temporal.now);

			// Validate the time entry (holiday check)
			const validation = await validateTimeEntry(emp.organizationId, now, timezone);
			if (!validation.isValid) {
				return {
					type: "text",
					text:
						validation.error || t("bot.cmd.clockout.cannotNow", "Cannot clock out at this time."),
				};
			}

			// Check if clock-out needs approval (0-day policy)
			let needsClockOutApproval = false;
			try {
				const checkEffect = Effect.gen(function* (_) {
					const policyService = yield* _(ChangePolicyService);
					return yield* _(policyService.checkClockOutNeedsApproval(emp.id));
				}).pipe(Effect.provide(ChangePolicyServiceLive), Effect.provide(DatabaseServiceLive));

				needsClockOutApproval = await Effect.runPromise(checkEffect);
			} catch (error) {
				logger.warn({ error }, "Failed to check clock-out approval requirement");
				return {
					type: "text",
					text: t(
						"bot.cmd.clockout.policyCheckFailed",
						"Could not verify time approval policy. Please try again.",
					),
				};
			}

			if (needsClockOutApproval) {
				return {
					type: "text",
					text: t(
						"bot.cmd.clockout.unsupportedApproval",
						"Time changes requiring approval are not supported for this action yet",
					),
				};
			}

			const timezoneCapture = resolveFallbackTimezoneCapture({
				timestamp: now,
				timezone,
				timezoneSource: "user_setting",
			});

			let durationMinutes: number;
			try {
				const result = await clockingService.clockOut({
					employeeId: emp.id,
					organizationId: emp.organizationId,
					createdBy: ctx.userId,
					action: { instant: instantFromDate(now), ...timezoneCapture },
					source: { ipAddress: "bot", deviceInfo: `${ctx.platform}-bot` },
				});
				durationMinutes = result.durationMinutes;
			} catch (error) {
				if (error instanceof ClockingConflictError) {
					return {
						type: "text",
						text: t("bot.cmd.clockout.notClockedIn", "You are not currently clocked in."),
					};
				}
				throw error;
			}

			try {
				await markEmployeeWorkBalanceDirty({
					employeeId: emp.id,
					organizationId: emp.organizationId,
					dirtyFromDate:
						DateTime.fromJSDate(activePeriod.startTime, { zone: "utc" }).toISODate() ?? undefined,
				});
			} catch (error) {
				logger.error(
					{
						error,
						employeeId: emp.id,
						organizationId: emp.organizationId,
						workPeriodId: activePeriod.id,
					},
					"Failed to mark work balance dirty after Teams clock-out",
				);
			}

			// Fire-and-forget: surcharges, compliance, break enforcement
			calculateAndPersistSurcharges(activePeriod.id, emp.organizationId).catch((err) => {
				logger.error({ error: err }, "Failed to calculate surcharges after clock-out");
			});

			checkComplianceAfterClockOut(
				emp.id,
				emp.organizationId,
				activePeriod.id,
				durationMinutes,
				timezone,
			).catch((err) => {
				logger.error({ error: err }, "Failed to check compliance after clock-out");
			});

			enforceBreaksAfterClockOut({
				employeeId: emp.id,
				organizationId: emp.organizationId,
				workPeriodId: activePeriod.id,
				sessionDurationMinutes: durationMinutes,
				timezone,
				createdBy: ctx.userId,
			})
				.then(async (breakEnforcementResult) => {
					if (!breakEnforcementResult.wasAdjusted) {
						return;
					}

					try {
						await markEmployeeWorkBalanceDirty({
							employeeId: emp.id,
							organizationId: emp.organizationId,
							dirtyFromDate:
								DateTime.fromJSDate(activePeriod.startTime, { zone: "utc" }).toISODate() ??
								undefined,
						});
					} catch (error) {
						logger.error(
							{
								error,
								employeeId: emp.id,
								organizationId: emp.organizationId,
								workPeriodId: activePeriod.id,
							},
							"Failed to mark work balance dirty after Teams break enforcement adjustment",
						);
					}
				})
				.catch((err) => {
					logger.error({ error: err }, "Failed to enforce breaks after clock-out");
				});

			// Format response
			const hours = Math.floor(durationMinutes / 60);
			const mins = durationMinutes % 60;

			return {
				type: "text",
				text: t(
					"bot.cmd.clockout.success",
					"Clocked out at {time}. Duration: {hours}h {minutes}m.",
					{ time: formatInstant(temporal.now, temporal, "time"), hours, minutes: mins },
				),
			};
		} catch (error) {
			logger.error({ error, ctx }, "Failed to clock out");
			throw error;
		}
	},
};
