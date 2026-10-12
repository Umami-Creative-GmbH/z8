import type { ReactNode } from "react";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";

/**
 * The kiosk page (#859) lives outside the authenticated app shell: a kiosk
 * device has no user session and authenticates with its device token.
 */
export default function KioskLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/kiosk" params={params}>
			{children}
		</RouteTranslationBoundary>
	);
}
