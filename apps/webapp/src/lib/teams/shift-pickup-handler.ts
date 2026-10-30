/**
 * Shift Pickup Handler
 *
 * Handles shift pickup requests from Teams bot interactive cards.
 * Creates shift request records and sends notifications.
 */

import type { TurnContext } from "botbuilder";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { employee, shift } from "@/db/schema";
import { runtime } from "@/lib/effect/runtime";
import {
	OpenShiftsService,
	OpenShiftsServiceLive,
} from "@/lib/effect/services/open-shifts.service";
import { createLogger } from "@/lib/logger";
import { currentRosterManagerRecipients } from "@/lib/notifications/manager-notice-recipients";
import { type NotificationCopy, translatedContent } from "@/lib/notifications/notification-copy";
import { notificationParam } from "@/lib/notifications/notification-params";
import { createNotification } from "@/lib/notifications/notification-service";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { ResolvedTenant } from "./types";

const logger = createLogger("TeamsShiftPickup");

/** Translated per recipient; the shift date is a typed calendar day (#812). */
const shiftPickupRequestedCopy = {
	named: {
		titleKey: "common:notifications.content.shiftPickupRequested.title",
		titleDefault: "Shift pickup request",
		messageKey: "common:notifications.content.shiftPickupRequested.message",
		messageDefault:
			"{requesterName} requested to pick up the shift on {shiftDate} ({startTime} - {endTime}).",
	},
	unnamedRequester: {
		titleKey: "common:notifications.content.shiftPickupRequested.title",
		titleDefault: "Shift pickup request",
		messageKey: "common:notifications.content.shiftPickupRequested.messageUnnamedRequester",
		messageDefault:
			"An employee requested to pick up the shift on {shiftDate} ({startTime} - {endTime}).",
	},
} as const satisfies Record<string, NotificationCopy>;

interface NotifyPrimaryManagerAboutShiftPickupParams {
	requestId: string;
	shiftId: string;
	requesterId: string;
	organizationId: string;
}

export async function notifyPrimaryManagerAboutShiftPickup(
	params: NotifyPrimaryManagerAboutShiftPickupParams,
): Promise<void> {
	const { requestId, shiftId, requesterId, organizationId } = params;
	try {
		const [requester, requestedShift, organizationTimezone] = await Promise.all([
			db.query.employee.findFirst({
				where: and(eq(employee.id, requesterId), eq(employee.organizationId, organizationId)),
				columns: { userId: true, firstName: true, lastName: true },
			}),
			db.query.shift.findFirst({
				where: and(eq(shift.id, shiftId), eq(shift.organizationId, organizationId)),
				columns: { date: true, startTime: true, endTime: true },
			}),
			loadOrganizationTimezone(db, organizationId),
		]);

		if (!requester || !requestedShift) {
			logger.debug(
				{ requesterId, shiftId, organizationId },
				"Missing data for shift pickup manager notification",
			);
			return;
		}

		// Actionable: the request waits for a decision. A former primary manager is
		// skipped, and with no current one the organization's admins decide (#1438).
		const recipients = await currentRosterManagerRecipients(db, {
			organizationId,
			employeeIds: [requesterId],
			notice: "actionable",
			primaryOnly: true,
			excludeUserIds: [requester.userId],
		});

		if (recipients.userIds.length === 0) {
			logger.debug({ requesterId, organizationId }, "No recipient for shift pickup request");
			return;
		}

		const requesterName = [requester.firstName, requester.lastName].filter(Boolean).join(" ");
		const copy = requesterName
			? shiftPickupRequestedCopy.named
			: shiftPickupRequestedCopy.unnamedRequester;
		const i18nParams = {
			...(requesterName ? { requesterName } : {}),
			shiftDate: notificationParam.plainDate(
				shiftCalendarDate(requestedShift.date, organizationTimezone),
				"weekdayMonthDay",
			),
			startTime: requestedShift.startTime,
			endTime: requestedShift.endTime,
		};
		const content = translatedContent(copy, i18nParams);

		await Promise.all(
			recipients.userIds.map((userId) =>
				createNotification({
					userId,
					organizationId,
					type: "shift_pickup_requested",
					title: content.title,
					message: content.message,
					entityType: "shift_request",
					entityId: requestId,
					actionUrl: "/scheduling",
					metadata: {
						shiftId,
						requesterId,
						recipientReason: recipients.reason,
						i18n: content.i18n,
					},
				}),
			),
		);
	} catch (error) {
		logger.error(
			{ error, requestId, shiftId, requesterId, organizationId },
			"Failed to notify primary manager about shift pickup request",
		);
	}
}

/**
 * Handle a shift pickup request from an Adaptive Card button click
 */
export async function handleShiftPickupAction(
	context: TurnContext,
	shiftId: string,
	requesterId: string,
	tenant: ResolvedTenant,
): Promise<void> {
	logger.info(
		{
			shiftId,
			requesterId,
			tenantId: tenant.tenantId,
			organizationId: tenant.organizationId,
		},
		"Processing shift pickup request",
	);

	try {
		// Request pickup using Effect-TS service
		// Note: requestShiftPickup atomically checks availability and creates the request
		// to avoid race conditions (TOCTOU vulnerability)
		const program = Effect.gen(function* () {
			const openShiftsService = yield* OpenShiftsService;

			const result = yield* openShiftsService.requestShiftPickup({
				shiftId,
				requesterId,
				organizationId: tenant.organizationId,
			});

			return { success: true, requestId: result.requestId };
		});

		const result = await runtime.runPromise(program.pipe(Effect.provide(OpenShiftsServiceLive)));

		logger.info(
			{ shiftId, requesterId, requestId: result.requestId },
			"Shift pickup request created successfully",
		);

		await context.sendActivity({
			type: "message",
			text: "✅ **Shift pickup request submitted!**\n\nYour manager will review and approve your request. You'll be notified once a decision is made.",
		});

		await notifyPrimaryManagerAboutShiftPickup({
			requestId: result.requestId,
			shiftId,
			requesterId,
			organizationId: tenant.organizationId,
		});
	} catch (error) {
		logger.error({ error, shiftId, requesterId }, "Failed to process shift pickup request");

		// Check for specific error types
		const errorMessage = error instanceof Error ? error.message : String(error);

		if (
			errorMessage.includes("not found") ||
			errorMessage.includes("unavailable") ||
			errorMessage.includes("not open")
		) {
			logger.warn({ shiftId, requesterId }, "Shift no longer available for pickup");
			await context.sendActivity({
				type: "message",
				text: "⚠️ **Shift no longer available**\n\nThis shift has already been assigned or is no longer open. Please check for other available shifts.",
			});
		} else if (
			errorMessage.includes("pending request") ||
			errorMessage.includes("already requested")
		) {
			await context.sendActivity({
				type: "message",
				text: "ℹ️ **Request already pending**\n\nYou already have a pending pickup request for this shift. Please wait for your manager to review it.",
			});
		} else {
			await context.sendActivity({
				type: "message",
				text: "❌ **Request failed**\n\nSomething went wrong while processing your request. Please try again or contact support.",
			});
		}
	}
}
