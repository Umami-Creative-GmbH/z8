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
): Promise<T> {
	const result = await persist();
	if (input.source === "sso") return result;
	if (!replayLoader)
		throw new Error("SCIM projection replay is not configured");
	const replay = await replayLoader();
	await replay(input.organizationId);
	return result;
}
