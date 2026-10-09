import { NextResponse } from "next/server";
import { z } from "zod";
import { clockIn, clockOut } from "@/app/[locale]/(app)/time-tracking/actions/clocking";
import { namedTaskId } from "@/lib/time-tracking/task-attribution";
import { WORK_LOCATION_TYPES } from "@/lib/time-tracking/work-location";

/**
 * Web clock in/out endpoint.
 *
 * Server action IDs can change between deployments, so a tab opened before a
 * deploy would fail to clock in/out. This route keeps a stable URL and request
 * contract for the web time clock. Keep the contract backwards compatible:
 * clients from the previous deployment still post here.
 */
/**
 * The position taken at the clock event (#826). Read by the clock action, which
 * drops a malformed one: a position never refuses the clock event.
 */
const position = z.unknown().optional();

const timeClockSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("clock_in"),
		// Optional: clients from before #479 send none and get a server identity.
		submissionId: z.uuid().optional(),
		workLocationType: z.enum(WORK_LOCATION_TYPES).optional(),
		browserTimezone: z.string().nullish(),
		position,
	}),
	z.object({
		action: z.literal("clock_out"),
		submissionId: z.uuid(),
		// Omitted keeps the active period's attribution; null clears it explicitly.
		projectId: z.string().min(1).nullable().optional(),
		// A task of the project (#874). Omitted, the task follows the project.
		taskId: z.string().min(1).nullable().optional(),
		workCategoryId: z.string().min(1).nullable().optional(),
		// Omitted applies the project's billable default (#900).
		billable: z.boolean().optional(),
		browserTimezone: z.string().nullish(),
		position,
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
	// Positions come only from the browser's session cookie; a bearer client's
	// clock event goes ahead unstamped, as on the frozen command route (#826 D5).
	const position = request.headers.has("authorization") ? undefined : body.position;
	try {
		const result =
			body.action === "clock_in"
				? await clockIn(body.workLocationType, {
						browserTimezone: body.browserTimezone,
						submissionId: body.submissionId,
						position,
					})
				: await clockOut(body.projectId, body.workCategoryId, {
						browserTimezone: body.browserTimezone,
						submissionId: body.submissionId,
						...namedTaskId(body.taskId),
						position,
						...(body.billable === undefined ? {} : { billable: body.billable }),
					});

		return NextResponse.json(result, { status: result.success ? 200 : 422 });
	} catch (error) {
		console.error("[time-clock] clock action failed", error);
		return invalidRequest(500, "Time clock action failed");
	}
}
