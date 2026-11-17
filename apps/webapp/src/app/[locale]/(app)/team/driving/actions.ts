"use server";

import { z } from "zod";
import { getTeamDrivingDetails } from "./driving-data";

const request = z.object({
	userId: z.string().min(1).max(256),
	organizationId: z.string().min(1).max(256),
	filters: z.object({
		teamId: z.string().max(256).nullable(),
		employeeId: z.string().max(256).nullable(),
	}),
});

/** A read only: every attempt resolves the current session and canonical manager scope. */
export async function readTeamDrivingDetails(input: z.infer<typeof request>) {
	const parsed = request.safeParse(input);
	if (!parsed.success) return { status: "forbidden" } as const;
	try {
		return await getTeamDrivingDetails(parsed.data.filters, parsed.data);
	} catch {
		// Do not expose database errors or misrepresent unavailable evidence as an empty list.
		return { status: "error" } as const;
	}
}
