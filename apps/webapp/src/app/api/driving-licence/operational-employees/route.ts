import { z } from "zod";
import { requireDrivingLicenceActor } from "@/lib/organization/driving-licence/context";
import { readOperationalDrivingEmployees } from "@/lib/organization/driving-licence/operational";

const headers = {
	"Cache-Control": "private, no-store, max-age=0",
	"X-Content-Type-Options": "nosniff",
};
export async function GET(request: Request) {
	try {
		const input = z
			.strictObject({
				organizationId: z.string().min(1),
				search: z.string().trim().max(100).default(""),
			})
			.parse(Object.fromEntries(new URL(request.url).searchParams));
		const actor = await requireDrivingLicenceActor();
		if (actor.organizationId !== input.organizationId)
			throw new Error("unavailable");
		return Response.json(
			{
				success: true,
				data: await readOperationalDrivingEmployees(actor, input.search),
			},
			{ headers },
		);
	} catch {
		return Response.json(
			{ success: false, error: "Driving authorization status is unavailable." },
			{ status: 404, headers },
		);
	}
}
