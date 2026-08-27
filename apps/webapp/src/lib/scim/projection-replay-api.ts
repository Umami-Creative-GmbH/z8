import type { SCIMProjectionReplayLoader } from "./role-projection-replay";

export interface SCIMProjectionReplayAPI {
	reconcileSCIMProjection(input: {
		body: { provisioningDomainId: string };
	}): Promise<unknown>;
}

export function createSCIMProjectionReplayLoader(
	api: SCIMProjectionReplayAPI,
): SCIMProjectionReplayLoader {
	return async () => async (organizationId) => {
		await api.reconcileSCIMProjection({
			body: { provisioningDomainId: organizationId },
		});
	};
}
