import { NextResponse } from "next/server";
import { z } from "zod";
import {
	MobileApiError,
	requireMobileEmployee,
	requireMobileSessionContext,
} from "@/app/api/mobile/shared";
import { clockIn, clockOut } from "@/app/[locale]/(app)/time-tracking/actions/clocking";

const mobileTimeClockSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("clock_in"),
		workLocationType: z.enum(["office", "home", "field", "other"], {
			error: "workLocationType is required for clock_in",
		}),
	}),
	z.object({
		action: z.literal("clock_out"),
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

		const result =
			parsedBody.data.action === "clock_in"
				? await clockIn(parsedBody.data.workLocationType)
				: await clockOut();

		if (!result.success) {
			return NextResponse.json({ error: result.error ?? "Time clock action failed" }, { status: 400 });
		}

		return NextResponse.json(result);
	} catch (error) {
		if (error instanceof MobileApiError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}

		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
