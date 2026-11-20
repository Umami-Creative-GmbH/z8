"use client";

import { PayrollPlaceholderTab } from "./payroll-workspace-tabs";
import type { PayrollTranslate } from "./state";

/** The Absences tab: the period's absence calendar and list, filled in by a later ticket. */
export function PayrollAbsencesTab({ t }: { t: PayrollTranslate }) {
	return (
		<PayrollPlaceholderTab
			description={t(
				"payroll.absences.placeholder",
				"The period's absences will appear here as a calendar and a list.",
			)}
		/>
	);
}
