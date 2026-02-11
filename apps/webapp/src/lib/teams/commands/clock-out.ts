/**
 * "Clock Out" Command
 *
 * Allows employees to clock out directly from a bot (Telegram, Teams, etc.).
 * Creates a time entry, updates the work period, and triggers post-clock-out
 * processing (compliance, surcharges, break enforcement, approval).
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { db } from "@/db";
import { employee, employeeManagers, timeEntry, userSettings, workPeriod } from "@/db/schema";
import { fmtTime, getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import {
	ChangePolicyService,
	ChangePolicyServiceLive,
} from "@/lib/effect/services/change-policy.service";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import { validateTimeEntry } from "@/lib/time-tracking/validation";
import {
	calculateAndPersistSurcharges,
	checkComplianceAfterClockOut,
	createClockOutApprovalRequest,
	enforceBreaksAfterClockOut,
} from "@/app/[locale]/(app)/time-tracking/actions";

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

			// Look up employee record for org verification
			const emp = await db.query.employee.findFirst({
				where: and(eq(employee.id, ctx.employeeId), eq(employee.organizationId, ctx.organizationId)),
			});

			if (!emp) {
				return { type: "text", text: t("bot.cmd.clockout.noProfile", "Employee profile not found.") };
			}

			// Get user timezone from userSettings
			const settingsData = await db.query.userSettings.findFirst({
				where: eq(userSettings.userId, ctx.userId),
				columns: { timezone: true },
			});
			const timezone = settingsData?.timezone || "UTC";

			// Check for active work period
			const activePeriod = await db.query.workPeriod.findFirst({
				where: and(eq(workPeriod.employeeId, emp.id), isNull(workPeriod.endTime)),
			});

			if (!activePeriod) {
				return { type: "text", text: t("bot.cmd.clockout.notClockedIn", "You are not currently clocked in.") };
			}

			const now = new Date();

			// Validate the time entry (holiday check)
			const validation = await validateTimeEntry(emp.organizationId, now, timezone);
			if (!validation.isValid) {
				return {
					type: "text",
					text: validation.error || t("bot.cmd.clockout.cannotNow", "Cannot clock out at this time."),
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
			}

			// Get previous entry for blockchain linking
			const [previousEntry] = await db
				.select()
				.from(timeEntry)
				.where(
					and(eq(timeEntry.employeeId, emp.id), eq(timeEntry.organizationId, emp.organizationId)),
				)
				.orderBy(desc(timeEntry.createdAt))
				.limit(1);

			// Calculate blockchain hash
			const hash = calculateHash({
				employeeId: emp.id,
				type: "clock_out",
				timestamp: now.toISOString(),
				previousHash: previousEntry?.hash || null,
			});

			// Create clock-out time entry
			const [entry] = await db
				.insert(timeEntry)
				.values({
					employeeId: emp.id,
					organizationId: emp.organizationId,
					type: "clock_out",
					timestamp: now,
					hash,
					previousHash: previousEntry?.hash || null,
					ipAddress: "bot",
					deviceInfo: `${ctx.platform}-bot`,
					createdBy: ctx.userId,
				})
				.returning();

			// Update work period
			const durationMs = now.getTime() - activePeriod.startTime.getTime();
			const durationMinutes = Math.floor(durationMs / 60000);
			const approvalStatus = needsClockOutApproval ? "pending" : "approved";

			const pendingChangesData = needsClockOutApproval
				? {
						originalStartTime: activePeriod.startTime.toISOString(),
						originalEndTime: now.toISOString(),
						originalDurationMinutes: durationMinutes,
						requestedAt: now.toISOString(),
						requestedBy: ctx.userId,
						isNewClockOut: true,
					}
				: null;

			await db
				.update(workPeriod)
				.set({
					clockOutId: entry.id,
					endTime: now,
					durationMinutes,
					isActive: false,
					approvalStatus,
					pendingChanges: pendingChangesData,
					updatedAt: new Date(),
				})
				.where(eq(workPeriod.id, activePeriod.id));

			// If clock-out needs approval, find the primary manager and create request
			if (needsClockOutApproval) {
				const primaryManager = await db.query.employeeManagers.findFirst({
					where: and(
						eq(employeeManagers.employeeId, emp.id),
						eq(employeeManagers.isPrimary, true),
					),
					columns: { managerId: true },
				});

				if (primaryManager) {
					createClockOutApprovalRequest({
						workPeriodId: activePeriod.id,
						employeeId: emp.id,
						managerId: primaryManager.managerId,
						organizationId: emp.organizationId,
						startTime: activePeriod.startTime,
						endTime: now,
						durationMinutes,
					}).catch((err) => {
						logger.error({ error: err }, "Failed to create clock-out approval request");
					});
				}
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
			}).catch((err) => {
				logger.error({ error: err }, "Failed to enforce breaks after clock-out");
			});

			// Format response
			const clockOutTime = DateTime.fromJSDate(now).setZone(timezone);
			const hours = Math.floor(durationMinutes / 60);
			const mins = durationMinutes % 60;

			let text = t("bot.cmd.clockout.success", "Clocked out at {time}. Duration: {hours}h {minutes}m.", { time: fmtTime(clockOutTime, ctx.locale), hours, minutes: mins });
			if (needsClockOutApproval) {
				text += `\n\n${t("bot.cmd.clockout.pendingApproval", "Your clock-out is pending manager approval.")}`;
			}

			return { type: "text", text };
		} catch (error) {
			logger.error({ error, ctx }, "Failed to clock out");
			throw error;
		}
	},
};
