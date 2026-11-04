import type { ReactNode } from "react";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";
export default function PersonalEquipmentLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/my-equipment" params={params}>
			{children}
		</RouteTranslationBoundary>
	);
}
