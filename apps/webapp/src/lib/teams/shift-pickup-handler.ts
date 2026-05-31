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
import { employee, employeeManagers, shift } from "@/db/schema";
import {
	OpenShiftsService,
	OpenShiftsServiceFullLive,
} from "@/lib/effect/services/open-shifts.service";
import { createLogger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/notification-service";
import type { ResolvedTenant } from "./types";

const logger = createLogger("TeamsShiftPickup");

interface NotifyPrimaryManagerAboutShiftPickupParams {
	requestId: string;
	shiftId: string;
	requesterId: string;
	organizationId: string;
}

export async function notifyPrimaryManagerAboutShiftPickup({
	requestId,
	shiftId,
	requesterId,
	organizationId,
}: NotifyPrimaryManagerAboutShiftPickupParams): Promise<void> {
	try {
		const primaryManager = await db.query.employeeManagers.findFirst({
			where: and(
				eq(employeeManagers.employeeId, requesterId),
				eq(employeeManagers.isPrimary, true),
			),
			columns: { managerId: true },
		});

		if (!primaryManager) {
			logger.debug({ requesterId, organizationId }, "No primary manager for shift pickup request");
			return;
		}

		const [requester, manager, requestedShift] = await Promise.all([
			db.query.employee.findFirst({
				where: and(eq(employee.id, requesterId), eq(employee.organizationId, organizationId)),
				columns: { firstName: true, lastName: true },
			}),
			db.query.employee.findFirst({
				where: and(eq(employee.id, primaryManager.managerId), eq(employee.organizationId, organizationId)),
				columns: { userId: true },
			}),
			db.query.shift.findFirst({
				where: and(eq(shift.id, shiftId), eq(shift.organizationId, organizationId)),
				columns: { date: true, startTime: true, endTime: true },
			}),
		]);

		if (!requester || !manager?.userId || !requestedShift) {
			logger.debug(
				{ requesterId, managerId: primaryManager.managerId, shiftId, organizationId },
				"Missing data for shift pickup manager notification",
			);
			return;
		}

		const requesterName =
			[requester.firstName, requester.lastName].filter(Boolean).join(" ") || "An employee";
		const shiftDate = requestedShift.date.toLocaleDateString("en-US", {
			weekday: "short",
			month: "short",
			day: "numeric",
		});

		await createNotification({
			userId: manager.userId,
			organizationId,
			type: "shift_pickup_requested",
			title: "Shift pickup request",
			message: `${requesterName} requested to pick up the shift on ${shiftDate} (${requestedShift.startTime} - ${requestedShift.endTime}).`,
			entityType: "shift_request",
			entityId: requestId,
			actionUrl: "/scheduling",
			metadata: {
				shiftId,
				requesterId,
				managerId: primaryManager.managerId,
			},
		});
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
		const program = Effect.gen(function* (_) {
			const openShiftsService = yield* _(OpenShiftsService);

			const result = yield* _(
				openShiftsService.requestShiftPickup({
					shiftId,
					requesterId,
					organizationId: tenant.organizationId,
				}),
			);

			return { success: true, requestId: result.requestId };
		});

		const result = await Effect.runPromise(program.pipe(Effect.provide(OpenShiftsServiceFullLive)));

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
