"use client";

import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WIDGET_CONFIGS, type WidgetId } from "./widget-registry";

interface DashboardCustomizeMenuProps {
	hiddenWidgets: WidgetId[];
	onVisibilityChange: (widgetId: WidgetId, visible: boolean) => void;
	onReset: () => void;
}

export function DashboardCustomizeMenu({
	hiddenWidgets,
	onVisibilityChange,
	onReset,
}: DashboardCustomizeMenuProps) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const hiddenWidgetSet = new Set(hiddenWidgets);

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={t("dashboard.customize.trigger", "Customize dashboard")}
					className="size-9"
					onClick={() => setOpen((currentOpen) => !currentOpen)}
					size="icon"
					variant="outline"
				>
					<IconAdjustmentsHorizontal className="size-4" aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				<DropdownMenuLabel>{t("dashboard.customize.title", "Dashboard widgets")}</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{WIDGET_CONFIGS.map((widget) => {
					const visible = !hiddenWidgetSet.has(widget.id);

					return (
						<DropdownMenuCheckboxItem
							checked={visible}
							key={widget.id}
							onCheckedChange={(checked) => onVisibilityChange(widget.id, checked === true)}
							onSelect={(event) => event.preventDefault()}
						>
							{t(widget.labelKey, widget.label)}
						</DropdownMenuCheckboxItem>
					);
				})}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={onReset}>
					{t("dashboard.customize.reset", "Reset layout")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
