import type { ReactNode } from "react";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";

interface ShareLayoutProps {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}

/** Report share link pages (#806): no app navigation, no sign-in, no analytics. */
export default function ShareLayout({ children, params }: ShareLayoutProps) {
	return (
		<RouteTranslationBoundary route="/share" params={params}>
			<div className="min-h-svh bg-background">{children}</div>
		</RouteTranslationBoundary>
	);
}
