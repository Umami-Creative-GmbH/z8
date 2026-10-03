import type { ReactNode } from "react";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";

export default function FeatureLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary
			route="/settings/enterprise/audit-log"
			params={params}
		>
			{children}
		</RouteTranslationBoundary>
	);
}
