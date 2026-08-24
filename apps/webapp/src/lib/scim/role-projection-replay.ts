export type SCIMProjectionReplayer = (organizationId: string) => Promise<void>;
export type SCIMProjectionReplayLoader = () => Promise<SCIMProjectionReplayer>;

let replayLoader: SCIMProjectionReplayLoader | null = null;

export function configureSCIMProjectionReplay(
	loader: SCIMProjectionReplayLoader | null,
) {
	replayLoader = loader;
}

export async function requestSCIMProjectionReplayAfter<T>(
	input: { organizationId: string; source: "manual" | "scim" | "sso" },
	persist: () => Promise<T>,
	compensate?: (snapshot: T) => Promise<unknown>,
): Promise<T> {
	if (input.source === "sso") return persist();
	if (!replayLoader || !compensate)
		throw new Error("SCIM projection replay is not configured");
	const replay = await replayLoader();
	const result = await persist();
	try {
		await replay(input.organizationId);
	} catch (replayError) {
		try {
			await compensate(result);
		} catch (compensationError) {
			throw new AggregateError(
				[replayError, compensationError],
				"SCIM projection replay and policy compensation failed",
			);
		}
		throw replayError;
	}
	return result;
}
