import { toast } from "sonner";
import { APPEND_REVIEW_REQUIRED_CODE } from "@/lib/time-tracking/time-clock-client";

type Translate = (key: string, defaultValue: string) => string;

/**
 * Shows the held clock-in outcome when the employee's time history needs operator
 * review. Returns false for any other result so callers keep their own handling.
 */
export function showAppendReviewRequiredToast(result: object, t: Translate): boolean {
	if (!("code" in result) || result.code !== APPEND_REVIEW_REQUIRED_CODE) return false;
	toast.error(
		t("timeTracking.errors.appendReviewRequired", "Clock-in needs a review of your time history"),
		{
			description: t(
				"timeTracking.errors.appendReviewRequiredDesc",
				"Your earlier time entries could not be verified, so a new clock-in was not saved. Please contact your administrator.",
			),
		},
	);
	return true;
}
