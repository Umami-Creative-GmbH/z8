"use client";

import { IconLoader2, IconTrash } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import type { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { KioskFobActionResult } from "@/lib/time-tracking/kiosk/fob-errors";
import { kioskFobErrorMessage } from "./kiosk-fob-text";

type Translate = ReturnType<typeof useTranslate>["t"];

const SPINNER = "mr-2 size-4 animate-spin motion-reduce:animate-none";

/**
 * "Remove fob", confirmed before it runs (#1508): on the employee page and the
 * employee's own security page. `remove` names the fob the card shows, so a
 * change made meanwhile is refused; after a removal, or such a refusal,
 * `onRefresh` shows what is true now.
 */
export function KioskFobRemoveControls({
	remove,
	confirmText,
	onRefresh,
	t,
}: {
	remove: () => Promise<KioskFobActionResult<{ removed: true }>>;
	confirmText: string;
	onRefresh: () => unknown;
	t: Translate;
}) {
	const [confirming, setConfirming] = useState(false);
	const removeMutation = useMutation({
		mutationFn: remove,
		onSuccess: (result) => {
			setConfirming(false);
			if (!result.success) {
				toast.error(kioskFobErrorMessage(t, result.code));
				// Someone else changed the fob: show what is true now.
				if (result.code === "fob_changed") void onRefresh();
				return;
			}
			toast.success(t("settings.kioskFob.removed", "Kiosk fob removed"));
			void onRefresh();
		},
		onError: () => toast.error(kioskFobErrorMessage(t, "failed")),
	});
	const busy = removeMutation.isPending;

	return (
		<>
			{confirming && (
				<p className="text-sm text-muted-foreground" role="alert">
					{confirmText}
				</p>
			)}
			<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
				{confirming ? (
					<>
						<Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button variant="destructive" onClick={() => removeMutation.mutate()} disabled={busy}>
							{busy && <IconLoader2 className={SPINNER} aria-hidden="true" />}
							{t("settings.kioskFob.confirmRemove", "Remove the fob")}
						</Button>
					</>
				) : (
					<Button variant="outline" onClick={() => setConfirming(true)} disabled={busy}>
						<IconTrash className="mr-2 size-4" aria-hidden="true" />
						{t("settings.kioskFob.remove", "Remove fob")}
					</Button>
				)}
			</div>
		</>
	);
}
