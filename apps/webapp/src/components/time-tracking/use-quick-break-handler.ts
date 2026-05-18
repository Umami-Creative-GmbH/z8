"use client";

import type { TFnType } from "@tolgee/react";
import { useCallback } from "react";
import { toast } from "sonner";

type AddBreakMutation = (params: { breakMinutes: number }) => Promise<{
	success: boolean;
	error?: string;
}>;

export function useQuickBreakHandler(addBreak: AddBreakMutation, t: TFnType) {
	return useCallback(
		async (breakMinutes: number) => {
			const result = await addBreak({ breakMinutes });

			if (result.success) {
				toast.success(t("timeTracking.quickBreak.success", "Break added"), {
					description: t(
						"timeTracking.quickBreak.successDescription",
						"You are still clocked in.",
					),
				});
				return { success: true };
			}

			const errorMessage =
				result.error ||
				t("timeTracking.quickBreak.errors.failed", "Failed to add break. Please try again.");

			toast.error(errorMessage);
			return { success: false, error: errorMessage };
		},
		[addBreak, t],
	);
}
