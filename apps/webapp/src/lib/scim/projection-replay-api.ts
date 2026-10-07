import { BetterAuthError } from "@better-auth/core/error";
import type { SCIMProjectionReplayLoader } from "./role-projection-replay";

export interface SCIMProjectionReplayAPI {
	reconcileSCIMProjection(input: { body: { provisioningDomainId: string } }): Promise<unknown>;
}

/** Matches upstream's retry budget for SCIM Group mutations. */
export const SCIM_PROJECTION_REPLAY_ATTEMPTS = 3;

/**
 * Thrown by `@better-auth/scim` when a replay loses the `scimSubject.revision`
 * compare-and-set to a concurrent subject writer. Upstream retries this for
 * Group mutations but not for `reconcileSCIMProjection`, and its predicate is
 * module-private, so the replayer matches the message (pinned by a unit test).
 */
export const SCIM_PROJECTION_SUBJECT_CONFLICT_MESSAGE =
	"The SCIM projection subject changed concurrently; retry the request.";

export function isSCIMProjectionSubjectConflict(error: unknown): boolean {
	return (
		error instanceof BetterAuthError && error.message === SCIM_PROJECTION_SUBJECT_CONFLICT_MESSAGE
	);
}

/**
 * Each attempt is a fresh endpoint call, so a lost subject race reruns in a new
 * transaction. Callers that compensate or defer on failure only see a conflict
 * once the attempts are spent; every other error fails at once.
 */
export function createSCIMProjectionReplayLoader(
	api: SCIMProjectionReplayAPI,
): SCIMProjectionReplayLoader {
	return async () => async (organizationId) => {
		for (let attempt = 1; ; attempt++) {
			try {
				await api.reconcileSCIMProjection({
					body: { provisioningDomainId: organizationId },
				});
				return;
			} catch (error) {
				if (attempt >= SCIM_PROJECTION_REPLAY_ATTEMPTS || !isSCIMProjectionSubjectConflict(error)) {
					throw error;
				}
			}
		}
	};
}
