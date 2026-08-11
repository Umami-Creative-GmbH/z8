import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarInset,
	SidebarProvider,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

export function AuthenticatedAppShell() {
	return (
		<SidebarProvider
			style={
				{
					"--sidebar-width": "calc(var(--spacing) * 72)",
					"--header-height": "calc(var(--spacing) * 12)",
				} as React.CSSProperties
			}
		>
			<Sidebar variant="inset">
				<SidebarHeader>
					<Skeleton className="h-10 w-full" />
				</SidebarHeader>
				<SidebarContent className="px-2 py-4">
					<Skeleton className="h-4 w-20" />
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-5/6" />
					<Skeleton className="mt-4 h-4 w-24" />
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-4/5" />
				</SidebarContent>
				<SidebarFooter>
					<Skeleton className="h-10 w-full" />
				</SidebarFooter>
			</Sidebar>
			<SidebarInset aria-busy="true" aria-label="Loading application">
				<header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b px-4 lg:px-6">
					<Skeleton className="size-7" />
					<Skeleton className="h-5 w-36" />
					<Skeleton className="ml-auto h-8 w-24" />
				</header>
				<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden p-4 lg:p-6">
					<Skeleton className="h-8 w-48" />
					<Skeleton className="h-5 w-full max-w-2xl" />
					<Skeleton className="min-h-64 w-full flex-1" />
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
