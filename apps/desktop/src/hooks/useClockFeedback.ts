import { toast } from "sonner";
import { useI18n } from "../lib/i18n";
import type { ClockCommandOutcome } from "../types";
export function useClockFeedback() {
	const { t } = useI18n();
	const present = async (
		action: () => Promise<ClockCommandOutcome>,
		success: string,
	) => {
		try {
			const result = await action();
			if (result.outcome === "savedOnDevice")
				toast.info(t("Saved on this device"));
			else if (
				result.outcome === "needsReview" ||
				result.outcome === "retainedForReview"
			)
				toast.warning(t("Saved work needs review"), {
					description: t(
						"Check your time entries in Z8 before recording replacement work.",
					),
				});
			else
				toast.success(
					t(result.write.contextChanged ? "Previous context updated" : success),
				);
			return true;
		} catch (error) {
			toast.error(t("Clock action failed"), {
				description: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	};

	return present;
}
