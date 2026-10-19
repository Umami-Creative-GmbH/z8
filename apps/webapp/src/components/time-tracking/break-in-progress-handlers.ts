import type { TFnType } from "@tolgee/react";
import { toast } from "sonner";
import type { BreakInProgressClientResult } from "@/lib/query/use-time-clock";

/**
 * Start Break and Resume feedback for the employee's own clock (#888, Time Tracking ADR 0007). A
 * break in progress is server state: both clock surfaces read it, and so do kiosks and the
 * employee's other devices.
 */

type BreakCommands = {
	startBreak: () => Promise<BreakInProgressClientResult>;
	resumeBreak: () => Promise<BreakInProgressClientResult>;
};

/** Toasts a refusal; a lost or unconfirmed answer never reads as success. */
function toastBreakRefusal(
	result: Extract<BreakInProgressClientResult, { success: false }>,
	t: TFnType,
) {
	if (result.uncertain) {
		toast.warning(
			t("timeTracking.breakInProgress.uncertain", "Your break could not be confirmed"),
			{
				description: t(
					"timeTracking.breakInProgress.uncertainDescription",
					"Your clock has been refreshed. Check it before trying again.",
				),
			},
		);
		return;
	}
	switch (result.code) {
		case "connection_required":
			toast.error(
				t(
					"timeTracking.breakInProgress.connectionRequired",
					"Starting or resuming a break needs a connection.",
				),
			);
			return;
		case "pending_clock_actions":
			toast.error(
				t(
					"timeTracking.breakInProgress.pendingClockActions",
					"Saved clock actions are still being sent. Try again once they are synced.",
				),
			);
			return;
	}
	toast.error(
		result.error ||
			t(
				"timeTracking.breakInProgress.errors.refreshed",
				"Your clock changed. It now shows the current state.",
			),
	);
}

/** The clock surfaces' Start Break and Resume, with their feedback. */
export function breakInProgressHandlers(commands: BreakCommands, t: TFnType) {
	return {
		handleStartBreak: async () => {
			const result = await commands.startBreak();
			if (!result.success) return toastBreakRefusal(result, t);
			toast.success(t("timeTracking.breakInProgress.started", "Break started"), {
				description: t(
					"timeTracking.breakInProgress.startedDescription",
					"Resume when you are back, or end your day.",
				),
			});
		},
		handleResumeBreak: async () => {
			const result = await commands.resumeBreak();
			if (!result.success) return toastBreakRefusal(result, t);
			toast.success(t("timeTracking.breakInProgress.resumed", "Work resumed"));
		},
	};
}
