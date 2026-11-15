"use client";

import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { EquipmentEmployeeHeader } from "./equipment-employee-header";

/** This route owns its arrival heading; the other equipment fallbacks retain theirs. */
export function EquipmentEmployeeLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.equipment.loading",
				labelDefault: "Loading equipment",
			}}
			role="status"
			className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6"
		>
			<div className="px-4 lg:px-6">
				<Skeleton aria-hidden="true" className="h-8 w-40" />
			</div>
			<div className="px-4 lg:px-6">
				<EquipmentEmployeeHeader />
			</div>
			<div className="px-4 lg:px-6">
				<Skeleton aria-hidden="true" className="h-96 w-full rounded-xl" />
			</div>
		</LoadingRegion>
	);
}
