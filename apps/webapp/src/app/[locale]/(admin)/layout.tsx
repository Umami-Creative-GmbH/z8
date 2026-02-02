import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { IconBuilding, IconHome, IconSettings, IconUsers } from "@tabler/icons-react";
import { auth } from "@/lib/auth";

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
			<header className="sticky top-0 z-50 border-b bg-card">
				<div className="container flex h-14 items-center justify-between">
					<div className="flex items-center gap-6">
						<Link href="/admin" className="flex items-center gap-2 font-semibold">
							<span className="bg-primary text-primary-foreground px-2 py-0.5 rounded text-xs font-bold">
								ADMIN
							</span>
							<span>Platform Admin</span>
						</Link>
						<nav className="flex items-center gap-4 text-sm">
							<Link
								href="/admin"
								className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
							>
								<IconHome className="size-4" aria-hidden="true" />
								Dashboard
							</Link>
							<Link
								href="/admin/users"
								className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
							>
								<IconUsers className="size-4" aria-hidden="true" />
								Users
							</Link>
							<Link
								href="/admin/organizations"
								className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
							>
								<IconBuilding className="size-4" aria-hidden="true" />
								Organizations
							</Link>
							<Link
								href="/admin/settings"
								className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
							>
								<IconSettings className="size-4" aria-hidden="true" />
								Settings
							</Link>
						</nav>
					</div>
					<div className="flex items-center gap-4">
						<span className="text-sm text-muted-foreground">
							{session.user.email}
						</span>
						<Link
							href="/"
							className="text-sm text-muted-foreground hover:text-foreground transition-colors"
						>
							Exit Admin
						</Link>
					</div>
				</div>
			</header>

			{/* Main Content */}
			<main className="container py-6">{children}</main>
		</div>
	);
}
