import { ServerAppSidebar } from "@/components/server-app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { adminGuard } from "@/lib/middleware/admin-guard";

export default async function SettingsLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	await adminGuard(locale);

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
				<div className="flex flex-1 flex-col">{children}</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
