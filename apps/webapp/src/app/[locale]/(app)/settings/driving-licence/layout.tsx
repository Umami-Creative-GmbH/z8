import type { ReactNode } from "react";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";

export default function DrivingLicenceSettingsLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/settings/driving-licence" params={params}>
			{children}
		</RouteTranslationBoundary>
	);
}
