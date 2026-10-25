"use client";

import { type ReactElement, useSyncExternalStore } from "react";
import { DashboardCustomizeMenu } from "@/components/dashboard/dashboard-customize-menu";
import { useWidgetOrder } from "@/components/dashboard/use-widget-order";

const subscribeToHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

export function DashboardHeaderCustomize({
	trigger,
}: {
	trigger?: ReactElement;
} = {}) {
	// The header has no server layout seed. A streamed sibling can populate its
	// query before this boundary hydrates, so keep the initial empty server view.
	const hydrated = useSyncExternalStore(
		subscribeToHydration,
		clientHydrated,
		serverHydrated,
	);
	const {
		visibleWidgetOrder,
		availableWidgetIds,
		hiddenWidgets,
		onReorder,
		onVisibilityChange,
		resetOrder,
		isLoading,
	} = useWidgetOrder(undefined, { waitForServerLayout: true });

	if (!hydrated || isLoading) {
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
