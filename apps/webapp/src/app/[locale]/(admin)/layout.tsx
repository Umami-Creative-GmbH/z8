import { Suspense } from "react";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";
import { AdminLayoutContent } from "./admin-layout-content";
import { AdminLayoutShell } from "./admin-layout-shell";

export default function AdminLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/platform-admin" params={params}>
			<Suspense fallback={<AdminLayoutShell />}>
				<AdminLayoutContent>{children}</AdminLayoutContent>
			</Suspense>
		</RouteTranslationBoundary>
	);
}
