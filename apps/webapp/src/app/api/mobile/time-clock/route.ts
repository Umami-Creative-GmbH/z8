import { NextResponse } from "next/server";
import { z } from "zod";
import {
	clockIn,
	clockOut,
} from "@/app/[locale]/(app)/time-tracking/actions/clocking";
import {
	MobileApiError,
	requireMobileEmployee,
	requireMobileSessionContext,
} from "@/app/api/mobile/shared";
import { parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import { isValidIanaTimezone } from "@/lib/time-tracking/timezone-capture";
import { WORK_LOCATION_TYPES } from "@/lib/time-tracking/work-location";

const MAX_ACTION_SKEW_MILLISECONDS = 5 * 60 * 1000;

const actionEvidenceFields = {
	timestamp: z.iso.datetime({ offset: true }),
	browserTimezone: z.string(),
	utcOffsetMinutes: z.number().int(),
};

const mobileTimeClockSchema = z.discriminatedUnion("action", [
	z.strictObject({
		action: z.literal("clock_in"),
		workLocationType: z.enum(WORK_LOCATION_TYPES, {
			error: "workLocationType is required for clock_in",
		}),
		...actionEvidenceFields,
	}),
	z.strictObject({
		action: z.literal("clock_out"),
		...actionEvidenceFields,
	}),
]);

export async function POST(request: Request) {
	try {
		const { session, activeOrganizationId } =
			await requireMobileSessionContext(request);

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
				{
					error: parsedBody.error.issues[0]?.message ?? "Invalid request body",
				},
				{ status: 400 },
			);
		}

		await requireMobileEmployee(session.user.id, activeOrganizationId);
		let actionInstant: ReturnType<typeof parseInstant>;
		try {
			actionInstant = parseInstant(parsedBody.data.timestamp);
		} catch {
			return NextResponse.json(
				{ error: "timestamp must be a UTC instant" },
				{ status: 400 },
			);
		}
		if (!parsedBody.data.timestamp.endsWith("Z")) {
			return NextResponse.json(
				{ error: "timestamp must be a UTC instant" },
				{ status: 400 },
			);
		}
		if (!isValidIanaTimezone(parsedBody.data.browserTimezone)) {
			return NextResponse.json(
				{ error: "Invalid browser timezone" },
				{ status: 400 },
			);
		}
		if (
			Math.abs(
				Number(
					systemClock.nowInstant().epochNanoseconds -
						actionInstant.epochNanoseconds,
				) / 1_000_000,
			) > MAX_ACTION_SKEW_MILLISECONDS
		) {
			return NextResponse.json(
				{ error: "Clock action timestamp is outside the allowed skew" },
				{ status: 400 },
			);
		}
		const derivedOffsetMinutes =
			actionInstant.toZonedDateTimeISO(parsedBody.data.browserTimezone)
				.offsetNanoseconds / 60_000_000_000;
		if (derivedOffsetMinutes !== parsedBody.data.utcOffsetMinutes) {
			return NextResponse.json(
				{ error: "Timezone offset does not match the action instant" },
				{ status: 400 },
			);
		}

		const result =
			parsedBody.data.action === "clock_in"
				? await clockIn(parsedBody.data.workLocationType, {
						browserTimezone: parsedBody.data.browserTimezone,
						instant: actionInstant,
						deviceInfo: "mobile",
					})
				: await clockOut(undefined, undefined, {
						browserTimezone: parsedBody.data.browserTimezone,
						instant: actionInstant,
						deviceInfo: "mobile",
					});

		if (!result.success) {
			return NextResponse.json(
				{ error: result.error ?? "Time clock action failed" },
				{ status: 400 },
			);
		}

		return NextResponse.json(result);
	} catch (error) {
		if (error instanceof MobileApiError) {
			return NextResponse.json(
				{ error: error.message },
				{ status: error.status },
			);
		}

		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}
