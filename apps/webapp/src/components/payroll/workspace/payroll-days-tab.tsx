"use client";

import { PayrollPlaceholderTab } from "./payroll-workspace-tabs";
import type { PayrollTranslate } from "./state";

/** The Days tab: hours per employee and day. Its grid arrives with the per-day read model. */
export function PayrollDaysTab({ t }: { t: PayrollTranslate }) {
	return (
		<PayrollPlaceholderTab
			description={t(
				"payroll.days.placeholder",
				"Hours per day for each employee will appear here.",
			)}
		/>
	);
}
