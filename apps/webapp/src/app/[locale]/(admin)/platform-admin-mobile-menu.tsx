"use client";

import { IconMenu2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Link, usePathname } from "@/navigation";
import {
	isActivePlatformAdminItem,
	type PlatformAdminNavItem,
	platformAdminIcons,
} from "./platform-admin-nav";

type PlatformAdminMobileMenuProps = {
	navItems: readonly PlatformAdminNavItem[];
	openMenuLabel: string;
	menuTitle: string;
};

export function PlatformAdminMobileMenu({
	navItems,
	openMenuLabel,
	menuTitle,
}: PlatformAdminMobileMenuProps) {
	const pathname = usePathname();

	return (
		<Sheet>
			<SheetTrigger asChild>
				<Button aria-label={openMenuLabel} className="md:hidden" size="icon" variant="ghost">
					<IconMenu2 className="size-5" aria-hidden="true" />
				</Button>
			</SheetTrigger>
			<SheetContent className="w-80 max-w-[85vw] gap-0 bg-background p-0" side="left">
				<SheetHeader className="border-b px-5 py-4 text-left">
					<SheetTitle>{menuTitle}</SheetTitle>
				</SheetHeader>
				<nav className="flex flex-col gap-1 p-3" aria-label={menuTitle}>
					{navItems.map((item) => {
						const isActive = isActivePlatformAdminItem(pathname, item);
						const Icon = platformAdminIcons[item.icon];

						return (
							<SheetClose asChild key={item.href}>
								<Link
									href={item.href}
									aria-current={isActive ? "page" : undefined}
									className={cn(
										"flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
										isActive
											? "bg-accent text-accent-foreground"
											: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
									)}
								>
									<Icon className="size-4" aria-hidden="true" />
									<span>{item.label}</span>
								</Link>
							</SheetClose>
						);
					})}
				</nav>
			</SheetContent>
		</Sheet>
	);
}
