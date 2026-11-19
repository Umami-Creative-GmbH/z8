"use client";

import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { EquipmentPersonalHeader } from "./equipment-personal-header";

export function EquipmentPersonalLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.equipment.loading",
				labelDefault: "Loading equipment",
			}}
			className="@container/main page-frame flex flex-1 flex-col gap-6"
		>
			<div className="space-y-6">
				<EquipmentPersonalHeader />
				<Skeleton aria-hidden="true" className="h-96 w-full rounded-xl" />
			</div>
		</LoadingRegion>
	);
}
