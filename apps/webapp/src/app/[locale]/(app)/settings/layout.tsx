import { Suspense } from "react";
import { SettingsBreadcrumbs } from "@/components/settings/settings-breadcrumbs";
import { SettingsNav } from "@/components/settings/settings-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { env } from "@/env";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function SettingsNavigation() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();
	const accessTier = settingsRouteContext?.accessTier ?? "member";
	const billingEnabled = env.BILLING_ENABLED === "true";

	return (
		<aside className="w-64 border-r bg-card hidden md:block overflow-auto">
			<SettingsNav accessTier={accessTier} billingEnabled={billingEnabled} />
		</aside>
	);
}

function SettingsBreadcrumbsLoading() {
	return (
		<div
			aria-hidden="true"
			className="mb-4 flex h-9 items-center gap-2 px-6 pt-4"
		>
			<Skeleton className="size-4" />
			<Skeleton className="h-4 w-40" />
		</div>
	);
}

function SettingsNavigationLoading() {
	return (
		<aside className="w-64 border-r bg-card hidden md:block overflow-auto">
			<div className="space-y-3 p-4">
				<Skeleton className="h-6 w-28" />
				<Skeleton className="h-5 w-full" />
				<Skeleton className="h-5 w-11/12" />
				<Skeleton className="h-5 w-10/12" />
			</div>
		</aside>
	);
}

export default function SettingsLayout({
	children,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
			<Suspense fallback={<SettingsNavigationLoading />}>
				<SettingsNavigation />
			</Suspense>
			<main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				<Suspense fallback={<SettingsBreadcrumbsLoading />}>
					<SettingsBreadcrumbs />
				</Suspense>
				<div className="min-w-0 flex-1 overflow-auto overflow-x-hidden">
					{children}
				</div>
			</main>
		</div>
	);
}
