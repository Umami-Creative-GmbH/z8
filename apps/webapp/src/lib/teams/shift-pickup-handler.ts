/**
 * Shift Pickup Handler
 *
 * Handles shift pickup requests from Teams bot interactive cards.
 * Creates shift request records and sends notifications.
 */

import type { TurnContext } from "botbuilder";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import { OpenShiftsService, OpenShiftsServiceFullLive } from "@/lib/effect/services/open-shifts.service";
import type { ResolvedTenant } from "./types";

const logger = createLogger("TeamsShiftPickup");

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

		const result = await Effect.runPromise(
			program.pipe(Effect.provide(OpenShiftsServiceFullLive)),
		);

		logger.info(
			{ shiftId, requesterId, requestId: result.requestId },
			"Shift pickup request created successfully",
		);

		await context.sendActivity({
			type: "message",
			text: "✅ **Shift pickup request submitted!**\n\nYour manager will review and approve your request. You'll be notified once a decision is made.",
		});

		// TODO: Send notification to manager about new pickup request
		// This would integrate with the existing notification service
	} catch (error) {
		logger.error({ error, shiftId, requesterId }, "Failed to process shift pickup request");

		// Check for specific error types
		const errorMessage = error instanceof Error ? error.message : String(error);

		if (errorMessage.includes("not found") || errorMessage.includes("unavailable") || errorMessage.includes("not open")) {
			logger.warn({ shiftId, requesterId }, "Shift no longer available for pickup");
			await context.sendActivity({
				type: "message",
				text: "⚠️ **Shift no longer available**\n\nThis shift has already been assigned or is no longer open. Please check for other available shifts.",
			});
		} else if (errorMessage.includes("pending request") || errorMessage.includes("already requested")) {
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
