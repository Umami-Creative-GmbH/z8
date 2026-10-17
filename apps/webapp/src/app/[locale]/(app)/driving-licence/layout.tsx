import type { ReactNode } from "react";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";
export default function DrivingLicenceLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/driving-licence" params={params}>
			{children}
		</RouteTranslationBoundary>
	);
}
