import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EquipmentRefreshButton } from "@/components/equipment/equipment-header-actions";
import { EquipmentPersonalHeader } from "@/components/equipment/equipment-personal-header";
import { EquipmentPersonalLoading } from "@/components/equipment/equipment-personal-loading";
import { PersonalEquipment } from "@/components/equipment/equipment-workspace";
import { getMyEquipment } from "@/lib/organization/equipment/actions";
import { getTranslate } from "@/tolgee/server";

async function PersonalEquipmentContent() {
	const [t, result] = await Promise.all([getTranslate(), getMyEquipment()]);
	if (!result.success && result.code === "AuthorizationError") notFound();
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{result.success ? (
				<PersonalEquipment data={result.data} />
			) : (
				<div className="mx-auto w-full max-w-6xl space-y-4 px-4 lg:px-6">
					<EquipmentPersonalHeader />
					<p role="alert" className="text-sm text-destructive">
						{t(
							"settings.equipment.personal.failed",
							"Your equipment could not be loaded. Reload the page to try again.",
						)}
					</p>
					<EquipmentRefreshButton>
						{t("settings.equipment.custody.reload", "Reload equipment")}
					</EquipmentRefreshButton>
				</div>
			)}
		</div>
	);
}
export default function PersonalEquipmentPage() {
	return (
		<Suspense fallback={<EquipmentPersonalLoading />}>
			<PersonalEquipmentContent />
		</Suspense>
	);
}
