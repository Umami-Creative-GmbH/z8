import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import {
	IconBuilding,
	IconChartBar,
	IconCreditCard,
	IconLogout,
	IconSettings,
	IconShield,
	IconUsers,
} from "@tabler/icons-react";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const navItems = [
	{ href: "/admin", icon: IconChartBar, label: "Overview" },
	{ href: "/admin/users", icon: IconUsers, label: "Users" },
	{ href: "/admin/organizations", icon: IconBuilding, label: "Organizations" },
	{ href: "/admin/billing", icon: IconCreditCard, label: "Billing" },
	{ href: "/admin/settings", icon: IconSettings, label: "Settings" },
];

export default async function AdminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
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

	return (
		<div className="min-h-screen bg-background">
			{/* Admin Header */}
			<header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/60">
				<div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-6 lg:px-8">
					{/* Left: Branding + Nav */}
					<div className="flex items-center gap-8">
						{/* Branding */}
						<Link
							href="/admin"
							className="group flex items-center gap-3 transition-opacity hover:opacity-80"
						>
							<div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
								<IconShield className="size-5" aria-hidden="true" />
							</div>
							<div className="hidden sm:block">
								<div className="text-sm font-semibold tracking-tight">Admin Console</div>
								<div className="text-xs text-muted-foreground">Platform Management</div>
							</div>
						</Link>

						{/* Divider */}
						<div className="hidden h-6 w-px bg-border/60 md:block" />

						{/* Navigation */}
						<nav className="hidden items-center gap-1 md:flex">
							{navItems.map((item) => (
								<Link
									key={item.href}
									href={item.href}
									className={cn(
										"flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
										"text-muted-foreground hover:bg-accent hover:text-accent-foreground",
									)}
								>
									<item.icon className="size-4" aria-hidden="true" />
									{item.label}
								</Link>
							))}
						</nav>
					</div>

					{/* Right: User + Exit */}
					<div className="flex items-center gap-4">
						<div className="hidden items-center gap-3 sm:flex">
							<div className="size-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
								{session.user.name?.charAt(0).toUpperCase() || session.user.email?.charAt(0).toUpperCase()}
							</div>
							<div className="hidden lg:block">
								<div className="text-sm font-medium">{session.user.name}</div>
								<div className="text-xs text-muted-foreground">{session.user.email}</div>
							</div>
						</div>

						<div className="hidden h-6 w-px bg-border/60 sm:block" />

						<Link
							href="/"
							className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
						>
							<IconLogout className="size-4" aria-hidden="true" />
							<span className="hidden sm:inline">Exit Admin</span>
						</Link>
					</div>
				</div>
			</header>

			{/* Main Content */}
			<main className="mx-auto max-w-screen-2xl px-6 py-8 lg:px-8">{children}</main>
		</div>
	);
}
