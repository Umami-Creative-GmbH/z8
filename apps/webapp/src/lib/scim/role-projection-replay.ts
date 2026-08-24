import { Temporal } from "temporal-polyfill";
import type { SCIMProjectionRecoveryStore } from "./projection-recovery";

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
	recoveryStore?: SCIMProjectionRecoveryStore,
): Promise<T> {
	if (input.source === "sso") return persist();
	if (!replayLoader || !compensate || !recoveryStore)
		throw new Error("SCIM projection replay is not configured");
	const replay = await replayLoader();
	const claim = await recoveryStore.begin(input.organizationId);
	let result: T;
	try {
		result = await persist();
	} catch (mutationError) {
		try {
			await recoveryStore.complete(claim, Temporal.Now.instant());
		} catch (recoveryPersistenceError) {
			throw new AggregateError(
				[mutationError, recoveryPersistenceError],
				"SCIM policy mutation and recovery completion failed",
			);
		}
		throw mutationError;
	}
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
		try {
			await replay(input.organizationId);
			await recoveryStore.complete(claim, Temporal.Now.instant());
		} catch (recoveryReplayError) {
			try {
				await recoveryStore.defer(claim, Temporal.Now.instant());
			} catch (recoveryPersistenceError) {
				throw new AggregateError(
					[replayError, recoveryReplayError, recoveryPersistenceError],
					"SCIM projection replay and recovery persistence failed",
				);
			}
			throw new AggregateError(
				[replayError, recoveryReplayError],
				"SCIM projection replay and compensating replay failed",
			);
		}
		throw replayError;
	}
	await recoveryStore.complete(claim, Temporal.Now.instant());
	return result;
}
