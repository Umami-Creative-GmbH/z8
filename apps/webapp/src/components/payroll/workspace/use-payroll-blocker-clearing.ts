"use client";

import type React from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { dismissPayrollBlockerAction } from "@/app/[locale]/(app)/payroll/actions";
import type { DismissiblePayrollBlocker } from "@/lib/payroll-workspace/blocker-dismissals";
import {
	type PayrollBlockerIdentity,
	payrollBlockerIdentity,
} from "@/lib/payroll-workspace/blocker-identity";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
import type {
	BlockerFocusRequest,
	PayrollPeriodRequest,
	PayrollTranslate,
	SummaryLoadResult,
} from "./state";

async function clearPayrollBlockerAndRefresh({
	blocker,
	clickRequest,
	isMountedRef,
	onFinished,
	onRemoved,
	refreshLatestSummary,
	t,
}: {
	blocker: DismissiblePayrollBlocker;
	clickRequest: PayrollPeriodRequest;
	isMountedRef: React.RefObject<boolean>;
	onFinished: (blockerKey: PayrollBlockerIdentity, dismissalSucceeded: boolean) => void;
	onRemoved: (summary: PayrollWorkspaceSummary) => void;
	refreshLatestSummary: (options: {
		onError: (error?: string) => void;
	}) => Promise<SummaryLoadResult>;
	t: PayrollTranslate;
}) {
	let dismissalSucceeded = false;
	const blockerKey = payrollBlockerIdentity(blocker);

	try {
		const dismissalResult = await dismissPayrollBlockerAction({
			...clickRequest,
			blockerId: blocker.id,
			blockerType: blocker.type,
		});
		if (!isMountedRef.current) return;

		if (!dismissalResult.success) {
			toast.error(
				dismissalResult.error ||
					t("payroll.blockers.clearFailed", "Could not clear payroll blocker"),
			);
			return;
		}

		dismissalSucceeded = true;
		const refreshResult = await refreshLatestSummary({
			onError: () =>
				toast.error(
					t(
						"payroll.blockers.refreshAfterClearFailed",
						"Blocker cleared, but payroll could not be refreshed",
					),
				),
		});
		if (!isMountedRef.current) return;

		if (
			refreshResult.status === "applied" &&
			!refreshResult.summary.blockers.some(
				(currentBlocker) => payrollBlockerIdentity(currentBlocker) === blockerKey,
			)
		) {
			onRemoved(refreshResult.summary);
		}
	} catch {
		if (isMountedRef.current) {
			toast.error(
				dismissalSucceeded
					? t(
							"payroll.blockers.refreshAfterClearFailed",
							"Blocker cleared, but payroll could not be refreshed",
						)
					: t("payroll.blockers.clearFailed", "Could not clear payroll blocker"),
			);
		}
	} finally {
		if (isMountedRef.current) onFinished(blockerKey, dismissalSucceeded);
	}
}

export function usePayrollBlockerClearing({
	blockers,
	clickRequest,
	isMountedRef,
	refreshLatestSummary,
	t,
}: {
	blockers: PayrollWorkspaceSummary["blockers"];
	clickRequest: PayrollPeriodRequest;
	isMountedRef: React.RefObject<boolean>;
	refreshLatestSummary: (options: {
		onError: (error?: string) => void;
	}) => Promise<SummaryLoadResult>;
	t: PayrollTranslate;
}) {
	const [clearingBlockerKeys, setClearingBlockerKeys] = useState<
		ReadonlySet<PayrollBlockerIdentity>
	>(() => new Set());
	const clearingBlockerKeysRef = useRef(new Set<PayrollBlockerIdentity>());
	const clearBlockerQueueRef = useRef<Promise<void> | null>(null);
	const focusRequestIdRef = useRef(0);
	const [focusRequest, setFocusRequest] = useState<BlockerFocusRequest | null>(null);

	function clearPayrollBlocker(
		blocker: DismissiblePayrollBlocker,
		activatedControl: HTMLButtonElement,
	) {
		if (!isMountedRef.current) return;
		const blockerKey = payrollBlockerIdentity(blocker);
		if (clearingBlockerKeysRef.current.has(blockerKey)) return;

		clearingBlockerKeysRef.current.add(blockerKey);
		setClearingBlockerKeys((currentKeys) => new Set(currentKeys).add(blockerKey));
		const currentClickRequest = clickRequest;
		const blockerOrder = blockers.map(payrollBlockerIdentity);
		const activatedControlHadFocus = document.activeElement === activatedControl;

		clearBlockerQueueRef.current = (clearBlockerQueueRef.current ?? Promise.resolve()).then(() =>
			isMountedRef.current
				? clearPayrollBlockerAndRefresh({
						blocker,
						clickRequest: currentClickRequest,
						isMountedRef,
						onFinished: (finishedBlockerKey, dismissalSucceeded) => {
							clearingBlockerKeysRef.current.delete(finishedBlockerKey);
							setClearingBlockerKeys((currentKeys) => {
								const nextKeys = new Set(currentKeys);
								nextKeys.delete(finishedBlockerKey);
								return nextKeys;
							});
							if (
								!dismissalSucceeded &&
								activatedControlHadFocus &&
								activatedControl.isConnected &&
								(document.activeElement === activatedControl ||
									document.activeElement === document.body)
							) {
								focusRequestIdRef.current += 1;
								setFocusRequest({
									id: focusRequestIdRef.current,
									targetBlockerKey: finishedBlockerKey,
								});
							}
						},
						onRemoved: (nextSummary) => {
							if (
								document.activeElement !== activatedControl &&
								!(activatedControlHadFocus && document.activeElement === document.body)
							)
								return;

							const removedIndex = blockerOrder.indexOf(blockerKey);
							const remainingBlockerKeys = new Set(
								nextSummary.blockers.map(payrollBlockerIdentity),
							);
							const nextBlockerKey = blockerOrder
								.slice(removedIndex + 1)
								.find((currentBlockerKey) => remainingBlockerKeys.has(currentBlockerKey));
							const previousBlockerKey = blockerOrder
								.slice(0, removedIndex)
								.reverse()
								.find((currentBlockerKey) => remainingBlockerKeys.has(currentBlockerKey));
							focusRequestIdRef.current += 1;
							setFocusRequest({
								id: focusRequestIdRef.current,
								targetBlockerKey: nextBlockerKey ?? previousBlockerKey ?? null,
							});
						},
						refreshLatestSummary,
						t,
					})
				: undefined,
		);
	}

	return { clearingBlockerKeys, clearPayrollBlocker, focusRequest };
}
