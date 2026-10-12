"use client";

import type { TFnType } from "@tolgee/react";
import { toast } from "sonner";
import { toastClockCommandError } from "./clock-command-error-toast";

type AddBreakMutation = (params: { breakMinutes: number }) => Promise<{
	success: boolean;
	error?: string;
	code?: string;
}>;

export function useQuickBreakHandler(addBreak: AddBreakMutation, t: TFnType) {
	return async (breakMinutes: number) => {
		const result = await addBreak({ breakMinutes });

		if (result.success) {
			toast.success(t("timeTracking.quickBreak.success", "Break added"), {
				description: t("timeTracking.quickBreak.successDescription", "You are still clocked in."),
			});
			return { success: true };
		}

		const errorMessage =
			result.error ||
			t("timeTracking.quickBreak.errors.failed", "Failed to add break. Please try again.");

		toastClockCommandError(result, errorMessage);
		return { success: false, error: errorMessage };
	};
}
