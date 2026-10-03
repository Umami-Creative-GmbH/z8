import type { ReactNode } from "react";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";

export default function EnterpriseLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/settings/enterprise" params={params}>
			{children}
		</RouteTranslationBoundary>
	);
}
