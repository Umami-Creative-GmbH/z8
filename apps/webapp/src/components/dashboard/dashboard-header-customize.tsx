"use client";

import type { ReactElement } from "react";
import { DashboardCustomizeMenu } from "@/components/dashboard/dashboard-customize-menu";
import { useWidgetOrder } from "@/components/dashboard/use-widget-order";

export function DashboardHeaderCustomize({ trigger }: { trigger?: ReactElement } = {}) {
	const {
		visibleWidgetOrder,
		availableWidgetIds,
		hiddenWidgets,
		onReorder,
		onVisibilityChange,
		resetOrder,
		isLoading,
	} = useWidgetOrder(undefined, { waitForServerLayout: true });

	if (isLoading) {
		return null;
	}

	return (
		<DashboardCustomizeMenu
			trigger={trigger}
			hiddenWidgets={hiddenWidgets}
			availableWidgetIds={availableWidgetIds}
			onReorder={onReorder}
			onReset={resetOrder}
			onVisibilityChange={onVisibilityChange}
			visibleWidgetOrder={visibleWidgetOrder}
		/>
	);
}
