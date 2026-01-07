import { ServerAppSidebar } from "@/components/server-app-sidebar";
import { SettingsBreadcrumbs } from "@/components/settings/settings-breadcrumbs";
import { SettingsNav } from "@/components/settings/settings-nav";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
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
		<SidebarProvider
			style={
				{
					"--sidebar-width": "calc(var(--spacing) * 72)",
					"--header-height": "calc(var(--spacing) * 12)",
				} as React.CSSProperties
			}
		>
			<ServerAppSidebar variant="inset" />
			<SidebarInset>
				<SiteHeader />
				<div className="flex flex-1">
					{/* Settings navigation sidebar */}
					<aside className="w-64 border-r bg-sidebar p-4 hidden md:block">
						<SettingsNav isAdmin={isAdmin} />
					</aside>

					{/* Main content area */}
					<main className="flex-1 overflow-auto">
						<SettingsBreadcrumbs />
						{children}
					</main>
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
