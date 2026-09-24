import { NextResponse } from "next/server";
import { z } from "zod";
import { clockIn, clockOut } from "@/app/[locale]/(app)/time-tracking/actions/clocking";
import { WORK_LOCATION_TYPES } from "@/lib/time-tracking/work-location";

/**
 * Web clock in/out endpoint.
 *
 * Server action IDs can change between deployments, so a tab opened before a
 * deploy would fail to clock in/out. This route keeps a stable URL and request
 * contract for the web time clock. Keep the contract backwards compatible:
 * clients from the previous deployment still post here.
 */
const timeClockSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("clock_in"),
		workLocationType: z.enum(WORK_LOCATION_TYPES).optional(),
		browserTimezone: z.string().nullish(),
	}),
	z.object({
		action: z.literal("clock_out"),
		submissionId: z.uuid(),
		projectId: z.string().min(1).optional(),
		workCategoryId: z.string().min(1).optional(),
		browserTimezone: z.string().nullish(),
	}),
]);

function invalidRequest(status: number, error: string) {
	return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: Request) {
	// Session cookies authenticate this route, so refuse cross-site callers.
	if (request.headers.get("sec-fetch-site") === "cross-site") {
		return invalidRequest(403, "Cross-site requests are not allowed");
	}
	if (!request.headers.get("content-type")?.startsWith("application/json")) {
		return invalidRequest(415, "Expected application/json");
	}

	let requestBody: unknown;
	try {
		requestBody = await request.json();
	} catch {
		return invalidRequest(400, "Invalid request body");
	}

	const parsedBody = timeClockSchema.safeParse(requestBody);
	if (!parsedBody.success) {
		return invalidRequest(400, "Invalid request body");
	}

	const body = parsedBody.data;
	try {
		const result =
			body.action === "clock_in"
				? await clockIn(body.workLocationType, { browserTimezone: body.browserTimezone })
				: await clockOut(body.projectId, body.workCategoryId, {
						browserTimezone: body.browserTimezone,
						submissionId: body.submissionId,
					});

		return NextResponse.json(result, { status: result.success ? 200 : 422 });
	} catch (error) {
		console.error("[time-clock] clock action failed", error);
		return invalidRequest(500, "Time clock action failed");
	}
}
