import { Suspense } from "react";
import { EquipmentSettings } from "@/components/settings/equipment/equipment-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getEquipmentSetup } from "@/lib/organization/equipment/actions";
import { getTranslate } from "@/tolgee/server";

async function EquipmentSettingsContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const [t, result] = await Promise.all([getTranslate(), getEquipmentSetup()]);
	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-4xl space-y-6">
				<header>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.equipment.title", "Equipment")}
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{t(
							"settings.equipment.description",
							"Configure equipment types, item identities and record retention.",
						)}
					</p>
				</header>
				{result.success ? (
					<EquipmentSettings key={organizationId} initialData={result.data} />
				) : (
					<p role="alert" className="text-sm text-destructive">
						{t(
							"settings.equipment.errors.load",
							"Equipment setup could not be loaded. Reload the page.",
						)}
					</p>
				)}
			</div>
		</div>
	);
}

export default function EquipmentSettingsPage() {
	return (
		<Suspense
			fallback={
				<div className="p-6">
					<Skeleton className="h-96 w-full" />
				</div>
			}
		>
			<EquipmentSettingsContent />
		</Suspense>
	);
}
