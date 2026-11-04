import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PersonalEquipment } from "@/components/equipment/equipment-workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { getMyEquipment } from "@/lib/organization/equipment/actions";
import { getTranslate } from "@/tolgee/server";

async function PersonalEquipmentContent() {
	const [t, result] = await Promise.all([getTranslate(), getMyEquipment()]);
	if (!result.success && result.code === "AuthorizationError") notFound();
	return (
		<div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
			<h1 className="text-2xl font-semibold tracking-tight">
				{t("settings.equipment.personal.title", "My equipment")}
			</h1>
			{result.success ? (
				<PersonalEquipment data={result.data} />
			) : (
				<p role="alert">
					{t(
						"settings.equipment.personal.failed",
						"Your equipment could not be loaded. Reload the page to try again.",
					)}
				</p>
			)}
		</div>
	);
}
export default function PersonalEquipmentPage() {
	return (
		<Suspense
			fallback={
				<div className="p-6">
					<Skeleton className="h-96 w-full" />
				</div>
			}
		>
			<PersonalEquipmentContent />
		</Suspense>
	);
}
