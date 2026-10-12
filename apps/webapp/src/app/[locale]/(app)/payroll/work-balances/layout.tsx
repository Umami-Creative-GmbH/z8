import type { ReactNode } from "react";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";

/** settings/people: the Work balance section is shared with the employee settings page. */
export default function PayrollWorkBalancesLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/payroll/work-balances" params={params}>
			{children}
		</RouteTranslationBoundary>
	);
}
