/**
 * "Clock In" Command
 *
 * Allows employees to clock in directly from a bot (Telegram, Teams, etc.).
 * Creates a time entry + work period, identical to the web UI clock-in
 * but without requiring an HTTP session.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { employee, timeEntry, userSettings, workPeriod } from "@/db/schema";
import { fmtTime, getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import { validateTimeEntry } from "@/lib/time-tracking/validation";

const logger = createLogger("BotCommand:ClockIn");

export const clockInCommand: BotCommand = {
	name: "clockin",
	aliases: ["in", "start", "ein"],
	description: "bot.cmd.clockin.desc",
	usage: "clockin",
	requiresAuth: true,
	handler: async (ctx: BotCommandContext): Promise<BotCommandResponse> => {
		try {
			const t = await getBotTranslate(ctx.locale);

			// Look up employee record for org verification
			const emp = await db.query.employee.findFirst({
				where: and(eq(employee.id, ctx.employeeId), eq(employee.organizationId, ctx.organizationId)),
			});

			if (!emp) {
				return { type: "text", text: t("bot.cmd.clockin.noProfile", "Employee profile not found.") };
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

			if (activePeriod) {
				const clockInTime = DateTime.fromJSDate(activePeriod.startTime).setZone(timezone);
				const now = DateTime.now().setZone(timezone);
				const duration = now.diff(clockInTime, ["hours", "minutes"]);
				const hours = Math.floor(duration.hours);
				const minutes = Math.floor(duration.minutes % 60);

				return {
					type: "text",
					text: t("bot.cmd.clockin.alreadyIn", "You are already clocked in since {time} ({hours}h {minutes}m).", { time: fmtTime(clockInTime, ctx.locale), hours, minutes }),
				};
			}

			const now = new Date();

			// Validate the time entry (holiday check)
			const validation = await validateTimeEntry(emp.organizationId, now, timezone);
			if (!validation.isValid) {
				return {
					type: "text",
					text: validation.error || t("bot.cmd.clockin.cannotNow", "Cannot clock in at this time."),
				};
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
				type: "clock_in",
				timestamp: now.toISOString(),
				previousHash: previousEntry?.hash || null,
			});

			// Create clock-in time entry
			const [entry] = await db
				.insert(timeEntry)
				.values({
					employeeId: emp.id,
					organizationId: emp.organizationId,
					type: "clock_in",
					timestamp: now,
					hash,
					previousHash: previousEntry?.hash || null,
					ipAddress: "bot",
					deviceInfo: `${ctx.platform}-bot`,
					createdBy: ctx.userId,
				})
				.returning();

			// Create work period
			await db.insert(workPeriod).values({
				employeeId: emp.id,
				organizationId: emp.organizationId,
				clockInId: entry.id,
				startTime: now,
			});

			const clockInTime = DateTime.fromJSDate(now).setZone(timezone);

			return {
				type: "text",
				text: t("bot.cmd.clockin.success", "Clocked in at {time}.", { time: fmtTime(clockInTime, ctx.locale) }),
			};
		} catch (error) {
			logger.error({ error, ctx }, "Failed to clock in");
			throw error;
		}
	},
};
