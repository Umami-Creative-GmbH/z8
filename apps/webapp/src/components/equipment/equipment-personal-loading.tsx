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
			className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6"
		>
			<div className="mx-auto w-full max-w-6xl space-y-6 px-4 lg:px-6">
				<EquipmentPersonalHeader />
				<Skeleton aria-hidden="true" className="h-96 w-full rounded-xl" />
			</div>
		</LoadingRegion>
	);
}
