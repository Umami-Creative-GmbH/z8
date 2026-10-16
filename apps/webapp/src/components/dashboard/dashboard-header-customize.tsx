"use client";

import type { ReactElement } from "react";
import { DashboardCustomizeMenu } from "@/components/dashboard/dashboard-customize-menu";
import { useWidgetOrder } from "@/components/dashboard/use-widget-order";

export function DashboardHeaderCustomize({
	trigger,
}: {
	trigger?: ReactElement;
} = {}) {
	const {
		visibleWidgetOrder,
		hiddenWidgets,
		onReorder,
		onVisibilityChange,
		resetOrder,
		isLoading,
	} = useWidgetOrder();

	if (isLoading) {
		return null;
	}

	return (
		<DashboardCustomizeMenu
			trigger={trigger}
			hiddenWidgets={hiddenWidgets}
			onReorder={onReorder}
			onReset={resetOrder}
			onVisibilityChange={onVisibilityChange}
			visibleWidgetOrder={visibleWidgetOrder}
		/>
	);
}
