"use client";

import { IconLayoutSidebar } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { type MouseEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { usePathname } from "@/navigation";

/**
 * Below `md` the settings sidebar is hidden; this opens the same navigation,
 * rendered by the settings layout, in a drawer. The drawer belongs to the route
 * it was opened on, so it closes when the route changes and when a link in it
 * is followed. Escape and focus return come from the Sheet primitive.
 */
export function SettingsMobileNav({ children }: { children: ReactNode }) {
	const { t } = useTranslate();
	const pathname = usePathname();
	const [openedOn, setOpenedOn] = useState<string | null>(null);

	// The settings hub lists every setting, so it needs no menu.
	if (pathname === "/settings") return null;

	const open = openedOn === pathname;
	const label = t("settings.mobileNav.open", "Settings menu");

	function closeOnLinkClick(event: MouseEvent<HTMLDivElement>) {
		if (event.target instanceof Element && event.target.closest("a[href]")) {
			setOpenedOn(null);
		}
	}

	return (
		<Sheet
			open={open}
			onOpenChange={(nextOpen) => setOpenedOn(nextOpen ? pathname : null)}
		>
			<SheetTrigger asChild>
				<Button type="button" variant="outline" size="sm" className="shrink-0 md:hidden">
					<IconLayoutSidebar className="size-4" aria-hidden="true" />
					{label}
				</Button>
			</SheetTrigger>
			<SheetContent side="left" className="w-80 max-w-[85vw] gap-0 bg-card p-0">
				<SheetHeader className="border-b px-4 py-3 pr-12 text-left">
					<SheetTitle>{t("settings.title", "Settings")}</SheetTitle>
				</SheetHeader>
				<div className="min-h-0 flex-1 overflow-y-auto" onClickCapture={closeOnLinkClick}>
					{children}
				</div>
			</SheetContent>
		</Sheet>
	);
}
