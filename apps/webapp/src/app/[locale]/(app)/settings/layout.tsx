import { connection } from "next/server";
import { Suspense } from "react";
import { SettingsBreadcrumbs } from "@/components/settings/settings-breadcrumbs";
import { SettingsNav } from "@/components/settings/settings-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function SettingsLayoutContent({
	children,
	params: _params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const settingsRouteContext = await getCurrentSettingsRouteContext();
	const accessTier = settingsRouteContext?.accessTier ?? "member";
	const billingEnabled = process.env.BILLING_ENABLED === "true";

	return (
		<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
			{/* Settings navigation sidebar */}
			<aside className="w-64 border-r bg-card p-4 hidden md:block overflow-auto">
				<SettingsNav accessTier={accessTier} billingEnabled={billingEnabled} />
			</aside>

			{/* Main content area */}
			<main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				<SettingsBreadcrumbs />
				<div className="min-w-0 flex-1 overflow-auto overflow-x-hidden">{children}</div>
			</main>
		</div>
	);
}

function SettingsLayoutLoading({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
			<aside className="w-64 border-r bg-card p-4 hidden md:block overflow-auto">
				<div className="space-y-3">
					<Skeleton className="h-6 w-28" />
					<Skeleton className="h-5 w-full" />
					<Skeleton className="h-5 w-11/12" />
					<Skeleton className="h-5 w-10/12" />
				</div>
			</aside>
			<main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				<div className="border-b p-4">
					<Skeleton className="h-5 w-64" />
				</div>
				<div className="min-w-0 flex-1 overflow-auto overflow-x-hidden">{children}</div>
			</main>
		</div>
	);
}

export default function SettingsLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	return (
		<Suspense fallback={<SettingsLayoutLoading>{children}</SettingsLayoutLoading>}>
			<SettingsLayoutContent params={params}>{children}</SettingsLayoutContent>
		</Suspense>
	);
}
