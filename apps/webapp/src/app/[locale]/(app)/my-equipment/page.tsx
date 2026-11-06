import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EquipmentLoading } from "@/components/equipment/equipment-loading";
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
				<div className="space-y-2 px-4 lg:px-6">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.equipment.personal.title", "My equipment")}
					</h1>
					<p role="alert" className="text-sm text-destructive">
						{t(
							"settings.equipment.personal.failed",
							"Your equipment could not be loaded. Reload the page to try again.",
						)}
					</p>
				</div>
			)}
		</div>
	);
}
export default function PersonalEquipmentPage() {
	return (
		<Suspense fallback={<EquipmentLoading variant="personal" />}>
			<PersonalEquipmentContent />
		</Suspense>
	);
}
