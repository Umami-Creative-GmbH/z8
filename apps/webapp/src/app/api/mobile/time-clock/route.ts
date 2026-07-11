import { NextResponse } from "next/server";
import { DateTime } from "luxon";
import { z } from "zod";
import { clockIn, clockOut } from "@/app/[locale]/(app)/time-tracking/actions/clocking";
import {
	MobileApiError,
	requireMobileEmployee,
	requireMobileSessionContext,
} from "@/app/api/mobile/shared";
import { isValidIanaTimezone } from "@/lib/time-tracking/timezone-capture";
import { WORK_LOCATION_TYPES } from "@/lib/time-tracking/work-location";
import { ClockingAccessError, clockingService } from "@/lib/time-tracking/clocking-service";

const MAX_ACTION_SKEW_MILLISECONDS = 5 * 60 * 1000;

const actionEvidenceFields = {
	timestamp: z.string().datetime({ offset: true }),
	browserTimezone: z.string(),
	utcOffsetMinutes: z.number().int(),
};

const mobileTimeClockSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("clock_in"),
		workLocationType: z.enum(WORK_LOCATION_TYPES, {
			error: "workLocationType is required for clock_in",
		}),
		...actionEvidenceFields,
	}).strict(),
	z.object({
		action: z.literal("clock_out"),
		...actionEvidenceFields,
	}).strict(),
]);

export async function POST(request: Request) {
	try {
		const { session, activeOrganizationId } = await requireMobileSessionContext(request);

		if (!activeOrganizationId) {
			throw new MobileApiError(400, "Active organization required");
		}

		let requestBody: unknown;
		try {
			requestBody = await request.json();
		} catch {
			return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
		}

		const parsedBody = mobileTimeClockSchema.safeParse(requestBody);
		if (!parsedBody.success) {
			return NextResponse.json(
				{ error: parsedBody.error.issues[0]?.message ?? "Invalid request body" },
				{ status: 400 },
			);
		}

		await clockingService.requireActor({
			userId: session.user.id,
			activeOrganizationId,
		});
		await requireMobileEmployee(session.user.id, activeOrganizationId);
		const actionInstant = DateTime.fromISO(parsedBody.data.timestamp, { setZone: true });
		if (!actionInstant.isValid || actionInstant.offset !== 0) {
			return NextResponse.json({ error: "timestamp must be a UTC instant" }, { status: 400 });
		}
		if (!isValidIanaTimezone(parsedBody.data.browserTimezone)) {
			return NextResponse.json({ error: "Invalid browser timezone" }, { status: 400 });
		}
		if (
			Math.abs(DateTime.utc().diff(actionInstant, "milliseconds").milliseconds) >
			MAX_ACTION_SKEW_MILLISECONDS
		) {
			return NextResponse.json({ error: "Clock action timestamp is outside the allowed skew" }, { status: 400 });
		}
		if (actionInstant.setZone(parsedBody.data.browserTimezone).offset !== parsedBody.data.utcOffsetMinutes) {
			return NextResponse.json({ error: "Timezone offset does not match the action instant" }, { status: 400 });
		}

		const result =
			parsedBody.data.action === "clock_in"
				? await clockIn(parsedBody.data.workLocationType, {
						browserTimezone: parsedBody.data.browserTimezone,
					})
				: await clockOut(undefined, undefined, {
						browserTimezone: parsedBody.data.browserTimezone,
					});

		if (!result.success) {
			return NextResponse.json(
				{ error: result.error ?? "Time clock action failed" },
				{ status: 400 },
			);
		}

		return NextResponse.json(result);
	} catch (error) {
		if (error instanceof ClockingAccessError) {
			return NextResponse.json({ error: error.message }, { status: 403 });
		}
		if (error instanceof MobileApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
