import { SettingsBreadcrumbs } from "@/components/settings/settings-breadcrumbs";
import { SettingsNav } from "@/components/settings/settings-nav";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function SettingsLayout({
	children,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const authContext = await getAuthContext();
	const isAdmin = authContext?.employee?.role === "admin";

	return (
		<div className="flex flex-1 overflow-hidden">
			{/* Settings navigation sidebar */}
			<aside className="w-64 border-r bg-card p-4 hidden md:block overflow-auto">
				<SettingsNav isAdmin={isAdmin} />
			</aside>

			{/* Main content area */}
			<main className="flex-1 flex flex-col overflow-hidden">
				<SettingsBreadcrumbs />
				<div className="flex-1 overflow-auto">{children}</div>
			</main>
		</div>
	);
}
