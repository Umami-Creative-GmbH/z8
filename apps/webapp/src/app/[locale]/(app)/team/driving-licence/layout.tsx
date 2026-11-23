import type { ReactNode } from "react";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";

/** Adds the verifier responsibility panel's settings copy to the Team catalog (#1937). */
export default function TeamDrivingLicenceLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/team/driving-licence" params={params}>
			{children}
		</RouteTranslationBoundary>
	);
}
