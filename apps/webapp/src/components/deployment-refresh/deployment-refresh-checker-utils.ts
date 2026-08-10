export type CheckDecisionInput = {
	checkCooldownMs: number;
	isDocumentHidden: boolean;
	lastCheckStartedAt: number;
	now: number;
};

export function shouldCheckDeploymentVersion(input: CheckDecisionInput) {
	return (
		!input.isDocumentHidden &&
		input.now - input.lastCheckStartedAt >= input.checkCooldownMs
	);
}

export function shouldPromptForBuildHash(
	clientBuildHash: string,
	serverBuildHash: string | null,
) {
	return Boolean(
		clientBuildHash && serverBuildHash && clientBuildHash !== serverBuildHash,
	);
}
