"use client";

import { useTranslate } from "@tolgee/react";
import { cn } from "@/lib/utils";

/**
 * What `arbzg_scope = 'executive_exempt'` does (#2023): leitende Angestellte are outside the
 * ArbZG (§ 18 Abs. 1 Nr. 1), so Z8 runs no adult ArbZG checks, deducts no breaks automatically and
 * sends no break reminders. JArbSchG youth protection still applies to minors.
 */
export function ExecutiveExemptNote({ id, className }: { id?: string; className?: string }) {
	const { t } = useTranslate();
	return (
		<p id={id} className={cn("text-muted-foreground text-xs", className)}>
			{t(
				"settings.contracts.arbzgScope.executiveExemptNote",
				"Executive exempt (leitende Angestellte, § 18 Abs. 1 Nr. 1 ArbZG): no adult ArbZG checks, automatic break deductions or break reminders. Youth protection (JArbSchG) still applies while the employee is under 18.",
			)}
		</p>
	);
}
