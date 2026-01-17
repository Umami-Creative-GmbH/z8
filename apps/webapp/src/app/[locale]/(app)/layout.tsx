import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PushPermissionProvider } from "@/components/notifications/push-permission-provider";
import { OrganizationSettingsProvider } from "@/components/providers/organization-settings-provider";
import { ServerAppSidebar } from "@/components/server-app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { auth } from "@/lib/auth";

interface AppLayoutProps {
	children: ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
	// Centralized auth check - protects all routes in the (app) group
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		redirect("/sign-in");
	}

	return (
		<PushPermissionProvider>
			<OrganizationSettingsProvider>
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
						<div className="flex flex-1 flex-col min-h-0 overflow-y-auto">{children}</div>
					</SidebarInset>
				</SidebarProvider>
			</OrganizationSettingsProvider>
		</PushPermissionProvider>
	);
}
