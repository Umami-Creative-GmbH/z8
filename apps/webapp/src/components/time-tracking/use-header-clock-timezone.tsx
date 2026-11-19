"use client";

import { useTranslate } from "@tolgee/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { updateTimezone } from "@/app/[locale]/(app)/settings/profile/actions";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { getBrowserTimezone } from "@/lib/time-tracking/timezone-capture";
import { TimezoneMismatchDialog } from "./timezone-mismatch-dialog";

type Confirmation = {
	scope: { key: string };
	savedTimezone: string;
	browserTimezone: string;
	submit: (timezone: string | null) => Promise<void>;
};

/** Confirmation only; command capture, admission and recovery stay with useTimeClock. */
export function useHeaderClockTimezone({
	scope,
	savedTimezone,
	isOffline,
}: {
	scope: string;
	savedTimezone: string;
	isOffline: boolean;
}) {
	const { t } = useTranslate();
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [pending, setPending] = useState(false);
	const continuing = useRef(false);
	// Returning to a scope must not revive an earlier confirmation.
	const scopeLifetime = useMemo(() => ({ key: scope }), [scope]);
	const currentScope = useRef<Confirmation["scope"] | null>(scopeLifetime);
	useLayoutEffect(() => {
		currentScope.current = scopeLifetime;
		return () => {
			currentScope.current = null;
		};
	}, [scopeLifetime]);

	async function confirm(submit: Confirmation["submit"]) {
		if (continuing.current) return;
		const browserTimezone = getBrowserTimezone();
		// Offline capture keeps its event-time context and existing review/queue contract.
		if (!isOffline && browserTimezone && browserTimezone !== savedTimezone) {
			setConfirmation({ scope: scopeLifetime, savedTimezone, browserTimezone, submit });
			return;
		}
		await submit(browserTimezone);
	}

	async function continueWithTimezone(update: boolean) {
		if (!confirmation || continuing.current || confirmation.scope !== currentScope.current) return;
		continuing.current = true;
		setPending(true);
		await runWithCleanup(
			async () => {
				try {
					if (update) {
						const result = await updateTimezone(confirmation.browserTimezone);
						if (!result?.success) {
							toast.error(
								result?.error ||
									t("header.timezone.updateError", "An error occurred while updating timezone"),
							);
							return;
						}
					}
					// A personal preference save can outlive the employee/organization shown.
					if (confirmation.scope !== currentScope.current) return;
					await confirmation.submit(confirmation.browserTimezone);
					setConfirmation(null);
				} catch {
					toast.error(
						t("header.timezone.updateError", "An error occurred while updating timezone"),
					);
				}
			},
			() => {
				continuing.current = false;
				setPending(false);
			},
		);
	}

	return {
		confirm,
		pending,
		prompt:
			confirmation?.scope === scopeLifetime ? (
				<TimezoneMismatchDialog
					open
					savedTimezone={confirmation.savedTimezone}
					browserTimezone={confirmation.browserTimezone}
					isPending={pending}
					onCancel={() => {
						if (!continuing.current) setConfirmation(null);
					}}
					onContinueOnce={() => void continueWithTimezone(false)}
					onUpdateAndContinue={() => void continueWithTimezone(true)}
				/>
			) : null,
	};
}
