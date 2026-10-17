"use client";

import { IconAlertTriangle, IconArrowLeft, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import type { KioskUncertainAction } from "@/lib/time-tracking/kiosk/uncertain-action";

interface KioskUncertainScreenProps {
	attempt: KioskUncertainAction;
	/** The pressed action's label. */
	actionLabel: string;
	check: "checking" | "unavailable" | "conflict";
	onHome: () => void;
}

/**
 * An online action whose reply was lost (#1363): the kiosk is checking with Z8
 * whether it was recorded. Nothing here lets the employee act again or switch
 * to another way of clocking: the turn waits for Z8's answer. Only an action Z8
 * cannot tell about (a conflict) offers a way back.
 */
export function KioskUncertainScreen({
	attempt,
	actionLabel,
	check,
	onHome,
}: KioskUncertainScreenProps) {
	const { t } = useTranslate();
	const conflict = check === "conflict";

	return (
		<div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 text-center">
			<div role="status" aria-live="polite" className="flex flex-col items-center gap-5">
				{conflict ? (
					<IconAlertTriangle
						className="size-20 text-amber-600 dark:text-amber-400"
						aria-hidden="true"
					/>
				) : (
					<IconLoader2
						className="size-20 animate-spin text-muted-foreground motion-reduce:animate-none"
						aria-hidden="true"
					/>
				)}
				<h1 className="text-3xl font-semibold text-balance">
					{t("timeTracking.kiosk.uncertain.title", "Checking whether your action was recorded")}
				</h1>
				<p className="text-2xl break-words">
					{t("timeTracking.kiosk.uncertain.action", "{name}: {action}", {
						name: attempt.employee.name,
						action: actionLabel,
					})}
				</p>
				{conflict ? null : (
					<p className="text-lg text-muted-foreground">
						{t(
							"timeTracking.kiosk.uncertain.wait",
							"Please wait. Do not clock again: the kiosk shows the result as soon as Z8 answers.",
						)}
					</p>
				)}
				{check === "unavailable" ? (
					<p className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-lg text-amber-900 dark:text-amber-100">
						{t(
							"timeTracking.kiosk.uncertain.unavailable",
							"Z8 cannot be reached right now. The kiosk keeps checking.",
						)}
					</p>
				) : null}
			</div>
			{conflict ? (
				<>
					<p
						role="alert"
						className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-lg text-destructive"
					>
						{t(
							"timeTracking.kiosk.uncertain.conflict",
							"This action could not be checked on this kiosk. Check your status with your manager before you clock again.",
						)}
					</p>
					<Button size="lg" variant="outline" className="h-14 min-w-48 text-lg" onClick={onHome}>
						<IconArrowLeft className="size-6" aria-hidden="true" />
						{t("timeTracking.kiosk.uncertain.back", "Back")}
					</Button>
				</>
			) : null}
		</div>
	);
}
