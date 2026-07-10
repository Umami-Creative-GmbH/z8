import { NextResponse } from "next/server";
import { z } from "zod";
import { clockIn, clockOut } from "@/app/[locale]/(app)/time-tracking/actions/clocking";
import {
	MobileApiError,
	requireMobileEmployee,
	requireMobileSessionContext,
} from "@/app/api/mobile/shared";
import {
	getUtcOffsetMinutesForZone,
	isValidIanaTimezone,
} from "@/lib/time-tracking/timezone-capture";
import { WORK_LOCATION_TYPES } from "@/lib/time-tracking/work-location";

const timezoneFields = {
	browserTimezone: z.string().optional(),
	timezone: z.string().optional(),
	instant: z.iso.datetime({ offset: true }).optional(),
	utcOffsetMinutes: z.number().int().min(-840).max(840).optional(),
};

const MAX_CLOCK_EVIDENCE_AGE_MS = 5 * 60_000;

const mobileTimeClockSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("clock_in"),
		workLocationType: z.enum(WORK_LOCATION_TYPES, {
			error: "workLocationType is required for clock_in",
		}),
		...timezoneFields,
	}),
	z.object({
		action: z.literal("clock_out"),
		...timezoneFields,
	}),
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

		await requireMobileEmployee(session.user.id, activeOrganizationId);
		const { instant, timezone, utcOffsetMinutes } = parsedBody.data;
		const hasTimezoneEvidence = instant !== undefined || utcOffsetMinutes !== undefined;
		if (
			hasTimezoneEvidence &&
			(instant === undefined || timezone === undefined || utcOffsetMinutes === undefined)
		) {
			return NextResponse.json(
				{ error: "Clock timezone evidence is incomplete" },
				{ status: 400 },
			);
		}

		let browserTimezone = isValidIanaTimezone(parsedBody.data.browserTimezone)
			? parsedBody.data.browserTimezone
			: undefined;
		if (instant !== undefined && timezone !== undefined && utcOffsetMinutes !== undefined) {
			const clientInstant = new Date(instant);
			if (Math.abs(Date.now() - clientInstant.getTime()) > MAX_CLOCK_EVIDENCE_AGE_MS) {
				return NextResponse.json(
					{ error: "Clock instant must be within five minutes" },
					{ status: 400 },
				);
			}
			if (!isValidIanaTimezone(timezone)) {
				return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
			}
			if (getUtcOffsetMinutesForZone(clientInstant, timezone) !== utcOffsetMinutes) {
				return NextResponse.json(
					{ error: "Timezone offset does not match instant" },
					{ status: 400 },
				);
			}

			browserTimezone = timezone;
		}

		const result =
			parsedBody.data.action === "clock_in"
				? browserTimezone
					? await clockIn(parsedBody.data.workLocationType, { browserTimezone })
					: await clockIn(parsedBody.data.workLocationType)
				: browserTimezone
					? await clockOut(undefined, undefined, { browserTimezone })
					: await clockOut();

		if (!result.success) {
			return NextResponse.json(
				{ error: result.error ?? "Time clock action failed" },
				{ status: 400 },
			);
		}

		return NextResponse.json(result);
	} catch (error) {
		if (error instanceof MobileApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
