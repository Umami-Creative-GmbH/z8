"use client";

import { IconTextSize } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFontSizePreference } from "./font-size-preference";
import { FONT_SIZE_OPTIONS, isFontSizePreference } from "./font-size-preference-utils";

export function FontSizeToggle() {
	const { t } = useTranslate();
	const { fontSize, setFontSize } = useFontSizePreference();
	const handleFontSizeChange = (value: string) => {
		if (isFontSizePreference(value)) {
			setFontSize(value);
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="icon">
					<IconTextSize aria-hidden="true" className="size-4" />
					<span className="sr-only">{t("common:user.font-size", "Font size")}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuRadioGroup value={fontSize} onValueChange={handleFontSizeChange}>
					{FONT_SIZE_OPTIONS.map((option) => (
						<DropdownMenuRadioItem key={option.value} value={option.value}>
							{t(`common:${option.labelKey}`, option.label)}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
