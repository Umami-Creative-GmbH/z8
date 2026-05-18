"use client";

import { IconAdjustmentsHorizontal, IconArrowDown, IconArrowUp } from "@tabler/icons-react";
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
	visibleWidgetOrder: WidgetId[];
	onReorder: (newOrder: WidgetId[]) => void;
	onReset: () => void;
}

export function DashboardCustomizeMenu({
	hiddenWidgets,
	onVisibilityChange,
	visibleWidgetOrder,
	onReorder,
	onReset,
}: DashboardCustomizeMenuProps) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const hiddenWidgetSet = new Set(hiddenWidgets);
	const visibleIndexByWidget = new Map(visibleWidgetOrder.map((widgetId, index) => [widgetId, index]));

	function moveWidget(widgetId: WidgetId, direction: "up" | "down") {
		const currentIndex = visibleIndexByWidget.get(widgetId);
		if (currentIndex === undefined) {
			return;
		}

		const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
		if (nextIndex < 0 || nextIndex >= visibleWidgetOrder.length) {
			return;
		}

		const nextOrder = [...visibleWidgetOrder];
		[nextOrder[currentIndex], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[currentIndex]];
		onReorder(nextOrder);
	}

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={t("dashboard.customize.trigger", "Customize dashboard")}
					className="size-9"
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
					const visibleIndex = visibleIndexByWidget.get(widget.id);
					const widgetLabel = t(widget.labelKey, widget.label);

					return (
						<div
							className="flex items-center gap-1"
							data-testid={`dashboard-widget-menu-row-${widget.id}`}
							key={widget.id}
						>
							<DropdownMenuCheckboxItem
								checked={visible}
								className="flex-1"
								onCheckedChange={(checked) => onVisibilityChange(widget.id, checked === true)}
								onSelect={(event) => event.preventDefault()}
							>
								{widgetLabel}
							</DropdownMenuCheckboxItem>
							{visible && visibleIndex !== undefined ? (
								<div className="flex shrink-0 items-center gap-0.5">
									<DropdownMenuItem
										asChild
										className="size-9 justify-center p-0"
										disabled={visibleIndex === 0}
										onSelect={(event) => event.preventDefault()}
									>
										<Button
											aria-label={t("dashboard.customize.move-up", "Move {widget} up", {
												widget: widgetLabel,
											})}
											disabled={visibleIndex === 0}
											onClick={(event) => {
												event.preventDefault();
												event.stopPropagation();
												moveWidget(widget.id, "up");
											}}
											size="icon"
											variant="ghost"
										>
											<IconArrowUp className="size-3.5" aria-hidden="true" />
										</Button>
									</DropdownMenuItem>
									<DropdownMenuItem
										asChild
										className="size-9 justify-center p-0"
										disabled={visibleIndex === visibleWidgetOrder.length - 1}
										onSelect={(event) => event.preventDefault()}
									>
										<Button
											aria-label={t("dashboard.customize.move-down", "Move {widget} down", {
												widget: widgetLabel,
											})}
											disabled={visibleIndex === visibleWidgetOrder.length - 1}
											onClick={(event) => {
												event.preventDefault();
												event.stopPropagation();
												moveWidget(widget.id, "down");
											}}
											size="icon"
											variant="ghost"
										>
											<IconArrowDown className="size-3.5" aria-hidden="true" />
										</Button>
									</DropdownMenuItem>
								</div>
							) : null}
						</div>
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
