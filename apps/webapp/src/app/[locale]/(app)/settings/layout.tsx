import { connection } from "next/server";
import { SettingsBreadcrumbs } from "@/components/settings/settings-breadcrumbs";
import { SettingsNav } from "@/components/settings/settings-nav";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

export default async function SettingsLayout({
	children,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const settingsRouteContext = await getCurrentSettingsRouteContext();
	const accessTier = settingsRouteContext?.accessTier ?? "member";
	const billingEnabled = process.env.BILLING_ENABLED === "true";

	return (
		<div className="flex flex-1 overflow-hidden">
			{/* Settings navigation sidebar */}
			<aside className="w-64 border-r bg-card p-4 hidden md:block overflow-auto">
				<SettingsNav accessTier={accessTier} billingEnabled={billingEnabled} />
			</aside>

			{/* Main content area */}
			<main className="flex-1 flex flex-col overflow-hidden">
				<SettingsBreadcrumbs />
				<div className="flex-1 overflow-auto">{children}</div>
			</main>
		</div>
	);
}
