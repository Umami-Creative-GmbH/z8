"use client";

import { IconChevronDown, IconMoon, IconSun, IconTextSize } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import {
	type ComponentType,
	type ReactNode,
	type SVGProps,
	useState,
	useSyncExternalStore,
} from "react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { fieldTriggerClassName } from "@/components/ui/field-trigger";
import { LANGUAGE_CONFIG } from "@/lib/language-config";
import { cn } from "@/lib/utils";

type OpenableControl = ComponentType<{ defaultOpen?: boolean }>;

/** One shared import per control; a failed chunk load is forgotten so a click can retry. */
function lazyControl(importControl: () => Promise<OpenableControl>) {
	let pending: Promise<OpenableControl> | null = null;
	return () => {
		pending ??= importControl().catch((error: unknown) => {
			pending = null;
			throw error;
		});
		return pending;
	};
}

const loadThemeToggle = lazyControl(() =>
	import("./theme-toggle").then((mod) => mod.ThemeToggle),
);
const loadFontSizeToggle = lazyControl(() =>
	import("./font-size-toggle").then((mod) => mod.FontSizeToggle),
);
const loadLanguageSwitcher = lazyControl(() =>
	import("./language-switcher").then((mod) => mod.LanguageSwitcher),
);

type TriggerProps = {
	onClick: () => void;
	onFocus: () => void;
	onPointerEnter: () => void;
};

/**
 * Renders a look-alike trigger until the first click, then the real Base UI
 * control already open. Hover and focus start the import early. Signed-out pages
 * keep the menu and select machinery out of their first-load JavaScript this way.
 */
function DeferredControl({
	load,
	placeholder,
}: {
	load: () => Promise<OpenableControl>;
	placeholder: (props: TriggerProps) => ReactNode;
}) {
	const [Control, setControl] = useState<OpenableControl | null>(null);
	const prefetch = () => {
		load().catch(() => {});
	};
	const open = () => {
		load()
			.then((loaded) => setControl(() => loaded))
			.catch(() => {});
	};
	if (Control) return <Control defaultOpen />;
	return placeholder({ onClick: open, onFocus: prefetch, onPointerEnter: prefetch });
}

function useMounted() {
	return useSyncExternalStore(
		() => () => {},
		() => true,
		() => false,
	);
}

function ThemeTrigger(props: TriggerProps) {
	const { t } = useTranslate();
	const { theme } = useTheme();
	const mounted = useMounted();
	return (
		<Button
			{...props}
			aria-haspopup="menu"
			data-slot="dropdown-menu-trigger"
			disabled={!mounted}
			size="icon"
			variant="outline"
		>
			{mounted && theme === "dark" ? (
				<IconMoon className="size-4" />
			) : (
				<IconSun className="size-4" />
			)}
			<span className="sr-only">{t("common:user.theme-toggle", "Toggle theme")}</span>
		</Button>
	);
}

function FontSizeTrigger(props: TriggerProps) {
	const { t } = useTranslate();
	return (
		<Button
			{...props}
			aria-haspopup="menu"
			data-slot="dropdown-menu-trigger"
			size="icon"
			variant="outline"
		>
			<IconTextSize aria-hidden="true" className="size-4" />
			<span className="sr-only">{t("common:user.font-size", "Font size")}</span>
		</Button>
	);
}

function LanguageTrigger(props: TriggerProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const config = LANGUAGE_CONFIG[locale];
	const Flag = config?.Flag as ComponentType<SVGProps<SVGSVGElement>> | undefined;
	return (
		<button
			{...props}
			aria-haspopup="listbox"
			aria-label={t("common.select-language", "Select language")}
			className={cn(
				fieldTriggerClassName,
				"h-9 w-[160px] bg-background *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2",
			)}
			data-size="default"
			data-slot="select-trigger"
			type="button"
		>
			<span data-slot="select-value">
				<span className="flex items-center gap-2">
					{Flag && <Flag className="h-4 w-auto" />}
					{config?.name ?? locale}
				</span>
			</span>
			<span aria-hidden="true">
				<IconChevronDown className="size-4 opacity-50" />
			</span>
		</button>
	);
}

/** Theme, font size and language controls for the signed-out pages' header. */
export function AuthShellControls() {
	return (
		<>
			<DeferredControl load={loadThemeToggle} placeholder={(props) => <ThemeTrigger {...props} />} />
			<DeferredControl
				load={loadFontSizeToggle}
				placeholder={(props) => <FontSizeTrigger {...props} />}
			/>
			<DeferredControl
				load={loadLanguageSwitcher}
				placeholder={(props) => <LanguageTrigger {...props} />}
			/>
		</>
	);
}
