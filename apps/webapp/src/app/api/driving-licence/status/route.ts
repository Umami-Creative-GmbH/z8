import { z } from "zod";
import { requireDrivingLicenceActor } from "@/lib/organization/driving-licence/context";
import { readOperationalDrivingStatus } from "@/lib/organization/driving-licence/operational";

const headers = {
	"Cache-Control": "private, no-store, max-age=0",
	"X-Content-Type-Options": "nosniff",
};
/** A GET deliberately avoids Next's sequential client server-action dispatch queue. */
export async function GET(request: Request) {
	try {
		const input = z
			.strictObject({
				organizationId: z.string().min(1),
				employeeId: z.uuid().optional(),
			})
			.parse(Object.fromEntries(new URL(request.url).searchParams));
		const actor = await requireDrivingLicenceActor();
		if (actor.organizationId !== input.organizationId)
			throw new Error("unavailable");
		return Response.json(
			{
				success: true,
				data: await readOperationalDrivingStatus(actor, input.employeeId),
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
