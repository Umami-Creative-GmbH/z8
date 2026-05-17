import { IconShield } from "@tabler/icons-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PlatformAdminHeaderActions } from "./platform-admin-header-actions";
import type { PlatformAdminNavItem } from "./platform-admin-header-actions";
import { auth } from "@/lib/auth";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
	const headersList = await headers();
	const session = await auth.api.getSession({ headers: headersList });

	// Redirect if not authenticated
	if (!session?.user) {
		redirect("/sign-in");
	}

	// Redirect if not a platform admin
	if (session.user.role !== "admin") {
		redirect("/");
	}

	const t = await getTranslate();
	const billingEnabled = process.env.BILLING_ENABLED === "true";

	const billingNavItems: PlatformAdminNavItem[] = billingEnabled
		? [
				{
					href: "/platform-admin/billing",
					icon: "billing",
					label: t("admin:admin.layout.nav.billing", "Billing"),
				},
			]
		: [];

	const navItems: PlatformAdminNavItem[] = [
		{
			href: "/platform-admin",
			icon: "overview",
			label: t("admin:admin.layout.nav.overview", "Overview"),
		},
		{
			href: "/platform-admin/analytics",
			icon: "analytics",
			label: t("admin:admin.layout.nav.analytics", "Analytics"),
		},
		{
			href: "/platform-admin/users",
			icon: "users",
			label: t("admin:admin.layout.nav.users", "Users"),
		},
		{
			href: "/platform-admin/organizations",
			icon: "organizations",
			label: t("admin:admin.layout.nav.organizations", "Organizations"),
		},
		...billingNavItems,
		{
			href: "/platform-admin/settings",
			icon: "settings",
			label: t("admin:admin.layout.nav.settings", "Settings"),
		},
		{
			href: "/platform-admin/worker-queue",
			icon: "workerQueue",
			label: t("admin:admin.layout.nav.workerQueue", "Worker Queue"),
		},
		{
			href: "/platform-admin/diagnostics",
			icon: "diagnostics",
			label: t("admin:admin.layout.nav.diagnostics", "Deployment Diagnostics"),
		},
	];

	return (
		<div className="min-h-screen bg-background">
			{/* Admin Header */}
			<header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/60">
				<div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-6 lg:px-8">
					{/* Left: Branding + Nav */}
					<div className="flex items-center gap-8">
						{/* Branding */}
						<Link
							href="/platform-admin"
							className="group flex items-center gap-3 transition-opacity hover:opacity-80"
						>
							<div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
								<IconShield className="size-5" aria-hidden="true" />
							</div>
							<div className="hidden sm:block">
								<div className="text-sm font-semibold tracking-tight">
									{t("admin:admin.layout.title", "Admin Console")}
								</div>
								<div className="text-xs text-muted-foreground">
									{t("admin:admin.layout.subtitle", "Platform Management")}
								</div>
							</div>
						</Link>

						{/* Divider */}
						<div className="hidden h-6 w-px bg-border/60 md:block" />

						<PlatformAdminHeaderActions
							navItems={navItems}
							exitLabel={t("admin:admin.layout.exitAdmin", "Exit Admin")}
							showExit={false}
						/>
					</div>

					{/* Right: User + Exit */}
					<div className="flex items-center gap-4">
						<div className="hidden items-center gap-3 sm:flex">
							<div className="size-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
								{session.user.name?.charAt(0).toUpperCase() ||
									session.user.email?.charAt(0).toUpperCase()}
							</div>
							<div className="hidden lg:block">
								<div className="text-sm font-medium">{session.user.name}</div>
								<div className="text-xs text-muted-foreground">{session.user.email}</div>
							</div>
						</div>

						<div className="hidden h-6 w-px bg-border/60 sm:block" />

						<PlatformAdminHeaderActions
							navItems={[]}
							exitLabel={t("admin:admin.layout.exitAdmin", "Exit Admin")}
						/>
					</div>
				</div>
			</header>

			{/* Main Content */}
			<main className="mx-auto max-w-screen-2xl px-6 py-8 lg:px-8">{children}</main>
		</div>
	);
}
