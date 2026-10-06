/**
 * The Effect v3 pieces of the approvals module that time tracking, already on Effect v4,
 * hands work to (#630). ApprovalDbService is still an Effect v3 contract, so time tracking
 * passes only plain clients and errors across. #632 deletes this file when the approvals
 * module moves to Effect v4.
 */
import { Cause, Effect, Runtime } from "effect-v3";
import { translateCorrectionWorkError } from "@/lib/time-tracking/correction-lifecycle-work";
import type { ApprovalDbService } from "./types";

/** The approval db service over a plain database client or transaction. */
export function approvalDbServiceForTransaction(dbService: { db: unknown }): ApprovalDbService {
	return {
		db: dbService.db as ApprovalDbService["db"],
		query: <T>(_name: string, operation: () => Promise<T>) => Effect.promise(operation),
	};
}

/**
 * translateCorrectionWorkError for an outcome an Effect v3 program wrapped in a
 * FiberFailure: the legacy correction decision runs the finalizer inside one. Effect v4
 * rejects with the error itself, so the time-tracking translation has no unwrapping.
 */
export function translateLegacyCorrectionWorkError(error: unknown): unknown {
	if (Runtime.isFiberFailure(error)) {
		const failure = Cause.squash(error[Runtime.FiberFailureCauseId]);
		const translated = translateLegacyCorrectionWorkError(failure);
		return translated === failure ? error : translated;
	}
	return translateCorrectionWorkError(error);
}
