import type { ReactNode } from "react";
import { AuthShellControls } from "@/components/auth-shell-controls";
import { InfoFooter } from "@/components/info-footer";
import { pageSafeAreaPaddingClassName } from "@/components/ui/safe-area";
import { RouteTranslationBoundary } from "@/tolgee/route-boundary";

export default function LicensesLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<RouteTranslationBoundary route="/licenses" params={params}>
			<div className="min-h-svh overflow-x-hidden bg-background">
				<section
					className={`flex min-h-svh flex-col px-4 sm:px-8 lg:px-10 ${pageSafeAreaPaddingClassName}`}
				>
					<div className="flex items-center justify-end gap-2">
						<AuthShellControls />
					</div>

					<main className="flex flex-1 items-center justify-center py-8 sm:py-10">
						<div className="w-full max-w-5xl">{children}</div>
					</main>

					<div className="pt-2 pb-2">
						<InfoFooter />
					</div>
				</section>
			</div>
		</RouteTranslationBoundary>
	);
}
