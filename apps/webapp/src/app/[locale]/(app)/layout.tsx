import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PushPermissionProvider } from "@/components/notifications/push-permission-provider";
import { OrganizationSettingsProvider } from "@/components/providers/organization-settings-provider";
import { ServerAppSidebar } from "@/components/server-app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { auth } from "@/lib/auth";
import { DOMAIN_HEADERS } from "@/proxy";

interface AppLayoutProps {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}

export default async function AppLayout({ children, params }: AppLayoutProps) {
	const { locale } = await params;

	// Centralized auth check - protects all routes in the (app) group
	const headersList = await headers();
	const session = await auth.api.getSession({ headers: headersList });

	if (!session?.user) {
		// Session cookie exists but is invalid - redirect to session-expired handler
		// which properly clears cookies before redirecting to sign-in.
		// This prevents redirect loops when proxy sees cookie but session is invalid.
		const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || `/${locale}`;
		const sessionExpiredUrl = `/api/auth/session-expired?locale=${locale}&callbackUrl=${encodeURIComponent(pathname)}`;
		redirect(sessionExpiredUrl);
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
