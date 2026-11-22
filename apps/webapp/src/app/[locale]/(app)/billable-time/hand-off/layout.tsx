import type { ReactNode } from "react";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";

export default function BillableHandOffLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/billable-time/hand-off" params={params}>
			{children}
		</RouteTranslationBoundary>
	);
}
