"use client";

import { IconClock, IconMoon, IconSun } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useSyncExternalStore } from "react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
	const { t } = useTranslate();
	const { theme, setTheme } = useTheme();
	const mounted = useSyncExternalStore(
		() => () => {},
		() => true,
		() => false,
	);

	if (!mounted) {
		return (
			<Button variant="outline" size="icon" disabled>
				<IconSun className="size-4" />
			</Button>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="icon">
					{theme === "dark" ? <IconMoon className="size-4" /> : <IconSun className="size-4" />}
					<span className="sr-only">{t("common:user.theme-toggle", "Toggle theme")}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={() => setTheme("light")}>
					<IconSun className="mr-2 size-4" />
					{t("common:user.theme-light", "Light")}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setTheme("dark")}>
					<IconMoon className="mr-2 size-4" />
					{t("common:user.theme-dark", "Dark")}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setTheme("time")}>
					<IconClock aria-hidden="true" className="mr-2 size-4" />
					{t("common:user.theme-time", "Time based")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
