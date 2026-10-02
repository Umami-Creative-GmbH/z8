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
			route="/settings/work-diagnostics"
			params={params}
		>
			{children}
		</RouteTranslationBoundary>
	);
}
