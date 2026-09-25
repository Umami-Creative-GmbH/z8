"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Temporal } from "temporal-polyfill";
import {
	createManualTimeEntry,
	lookupManualTimeEntry,
} from "@/app/[locale]/(app)/time-tracking/actions";
import type {
	ManualTimeEntryLookup,
	ManualTimeEntryResult,
} from "@/app/[locale]/(app)/time-tracking/actions/types";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";
import {
	beginManualAttempt,
	canDiscardManualRecovery,
	discardManualRecovery,
	freezeManualCommand,
	frozenManualCommand,
	listManualRecoveries,
	lookupVerdict,
	type ManualAttemptVerdict,
	type ManualLookupVerdict,
	type ManualRecoveryRecord,
	type ManualRecoveryScope,
	settleManualAttempt,
	settleManualLookup,
	submissionVerdict,
	tabRecoveryStorage,
} from "./manual-command-recovery";

export interface ManualAttemptOutcome {
	/** `undefined` when the request itself failed (no response). */
	result: ManualTimeEntryResult | undefined;
	verdict: ManualAttemptVerdict;
	record: ManualRecoveryRecord | null;
}

export interface ManualLookupOutcome {
	result: ManualTimeEntryLookup | undefined;
	verdict: ManualLookupVerdict;
	record: ManualRecoveryRecord | null;
}

function recoveryContextOf(record: ManualRecoveryRecord) {
	return { userId: record.scope.userId, organizationId: record.scope.organizationId };
}

/**
 * Frozen version-2 manual commands of one user, organization and target in
 * this tab (#310). The dialog submits through `submit`, which stores the command
 * before the request leaves; `retry` resends exactly the stored command and
 * `lookup` only inspects. Nothing here runs on its own.
 */
export function useManualCommandRecovery(scope: ManualRecoveryScope | null) {
	const storage = useMemo(() => tabRecoveryStorage(), []);
	const scopeKey = scope ? JSON.stringify(scope) : null;
	const [records, setRecords] = useState<ManualRecoveryRecord[]>([]);
	const [busyId, setBusyId] = useState<string | null>(null);

	const refresh = useCallback(() => {
		setRecords(scopeKey ? listManualRecoveries(storage, JSON.parse(scopeKey)) : []);
	}, [scopeKey, storage]);
	useEffect(refresh, [refresh]);

	async function attempt(
		record: ManualRecoveryRecord,
		previous: ManualRecoveryRecord | null,
	): Promise<ManualAttemptOutcome> {
		const begun = beginManualAttempt(storage, record);
		refresh();
		let result: ManualTimeEntryResult | undefined;
		try {
			// The stored bytes, with the user and organization they were frozen for.
			result = await createManualTimeEntry(frozenManualCommand(begun), recoveryContextOf(begun));
		} catch {
			result = undefined;
		}
		const verdict = submissionVerdict(result);
		const settled = settleManualAttempt(storage, { previous, begun, verdict });
		refresh();
		return { result, verdict, record: settled };
	}

	/** Freeze a confirmed command and send its first attempt. */
	async function submit(
		frozenScope: ManualRecoveryScope,
		command: ManualTimeEntryCommand,
	): Promise<ManualAttemptOutcome> {
		const frozen = freezeManualCommand(frozenScope, command, Temporal.Now.instant().toString());
		return attempt(frozen, null);
	}

	/**
	 * Act on the stored record, not a rendered copy: another dialog in this tab
	 * may have settled it meanwhile. Null when it is gone.
	 */
	async function withStored<T>(
		shown: ManualRecoveryRecord,
		task: (record: ManualRecoveryRecord) => Promise<T>,
	): Promise<T | null> {
		const record = listManualRecoveries(storage, shown.scope).find(
			(candidate) => candidate.submissionId === shown.submissionId,
		);
		if (!record) {
			refresh();
			return null;
		}
		setBusyId(record.submissionId);
		try {
			return await task(record);
		} finally {
			setBusyId(null);
		}
	}

	/** Resend exactly the frozen command under its identity. */
	function retry(shown: ManualRecoveryRecord) {
		return withStored(shown, (record) => attempt(record, record));
	}

	/** Inspect the outcome without sending the command for creation. */
	function lookup(shown: ManualRecoveryRecord): Promise<ManualLookupOutcome | null> {
		return withStored(shown, async (record) => {
			let result: ManualTimeEntryLookup | undefined;
			try {
				result = await lookupManualTimeEntry(
					frozenManualCommand(record),
					recoveryContextOf(record),
				);
			} catch {
				result = undefined;
			}
			const verdict = lookupVerdict(result);
			const settled = settleManualLookup(storage, record, verdict);
			refresh();
			return { result, verdict, record: settled };
		});
	}

	function discard(shown: ManualRecoveryRecord) {
		const record = listManualRecoveries(storage, shown.scope).find(
			(candidate) => candidate.submissionId === shown.submissionId,
		);
		if (record && canDiscardManualRecovery(record)) discardManualRecovery(storage, record);
		refresh();
	}

	return { records, busyId, refresh, submit, retry, lookup, discard };
}
