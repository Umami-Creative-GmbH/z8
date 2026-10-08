import {
	IconCar,
	IconPlaneDeparture,
	type IconProps,
	IconReceipt,
	IconToolsKitchen2,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import type { TravelExpenseReportItemType } from "@/db/schema/travel-expense";
import { cn } from "@/lib/utils";

/** The one icon of each expense type, wherever expenses are listed, added or edited. */
export const ITEM_TYPE_ICONS: Record<TravelExpenseReportItemType, ComponentType<IconProps>> = {
	receipt: IconReceipt,
	mileage: IconCar,
	per_diem: IconToolsKitchen2,
};

/** The icon of a trip report, which collects several expenses. */
export const TRIP_ICON = IconPlaneDeparture;

export function ItemTypeIcon({
	type,
	className,
}: {
	type: TravelExpenseReportItemType;
	className?: string;
}) {
	const Icon = ITEM_TYPE_ICONS[type];
	return (
		<Icon aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground", className)} />
	);
}
