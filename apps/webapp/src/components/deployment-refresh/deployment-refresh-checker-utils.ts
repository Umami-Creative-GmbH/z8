export type CheckDecisionInput = {
	idleThresholdMs: number;
	isDocumentHidden: boolean;
	lastActivityAt: number;
	now: number;
};

export function shouldCheckDeploymentVersion({
	idleThresholdMs,
	isDocumentHidden,
	lastActivityAt,
	now,
}: CheckDecisionInput) {
	return isDocumentHidden || now - lastActivityAt >= idleThresholdMs;
}

export function shouldReloadForBuildHash(clientBuildHash: string, serverBuildHash: string | null) {
	return Boolean(clientBuildHash && serverBuildHash && clientBuildHash !== serverBuildHash);
}
