"use server";

import { getWhoIsInLocations } from "./presence-data";

export type PresenceSelectionScope = { userId: string; organizationId: string };
export type PresenceSelectionResult =
	| ({ status: "ok"; locations: { id: string; name: string }[] } & PresenceSelectionScope)
	| { status: "forbidden" | "changed" | "error" };

/** Expected scope refuses stale arrivals; the existing presence owner grants access. */
export async function readPresenceLocations(
	expected: PresenceSelectionScope,
): Promise<PresenceSelectionResult> {
	try {
		const result = await getWhoIsInLocations();
		if (result.status === "forbidden") return result;
		const { userId, organizationId } = result.viewer;
		if (userId !== expected.userId || organizationId !== expected.organizationId) {
			return { status: "changed" };
		}
		return { status: "ok", userId, organizationId, locations: result.locations };
	} catch {
		return { status: "error" };
	}
}
