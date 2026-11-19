import type { ServerActionResult } from "@/lib/effect/result";

const ACCESS_REFUSALS = new Set(["Not found", "Unauthorized"]);

/** Persist a withdrawn read so an outage cannot restore its previous evidence. */
export async function readFinanceResult<T>(
	read: Promise<ServerActionResult<T>>,
): Promise<T | null> {
	try {
		const result = await read;
		if (!result.success) throw new Error(result.error);
		return result.data;
	} catch (failure) {
		if (failure instanceof Error && ACCESS_REFUSALS.has(failure.message)) return null;
		throw failure;
	}
}
