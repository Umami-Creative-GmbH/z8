"use client";

import { DashboardCustomizeMenu } from "@/components/dashboard/dashboard-customize-menu";
import { useWidgetOrder } from "@/components/dashboard/use-widget-order";

export function DashboardHeaderCustomize() {
	const { visibleWidgetOrder, hiddenWidgets, onReorder, onVisibilityChange, resetOrder, isLoading } =
		useWidgetOrder();

	if (isLoading) {
		return null;
	}

	return (
		<DashboardCustomizeMenu
			hiddenWidgets={hiddenWidgets}
			onReorder={onReorder}
			onReset={resetOrder}
			onVisibilityChange={onVisibilityChange}
			visibleWidgetOrder={visibleWidgetOrder}
		/>
	);
}
