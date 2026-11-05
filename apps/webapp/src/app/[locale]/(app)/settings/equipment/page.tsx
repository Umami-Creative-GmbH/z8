import { Suspense } from "react";
import { EquipmentOfficers } from "@/components/settings/equipment/equipment-officers";
import { EquipmentSettings } from "@/components/settings/equipment/equipment-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import {
	getEquipmentOfficerGrants,
	getEquipmentSetup,
} from "@/lib/organization/equipment/actions";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

async function EquipmentSettingsContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const [t, result, officers] = await Promise.all([
		getTranslate(),
		getEquipmentSetup(),
		getEquipmentOfficerGrants(),
	]);
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
					<Link
						href="/equipment"
						className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
					>
						{t("settings.equipment.openOverview", "Open equipment overview")}
					</Link>
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
				{officers.success ? (
					<EquipmentOfficers data={officers.data} />
				) : (
					<p role="alert">
						{t(
							"settings.equipment.officers.loadFailed",
							"Equipment responsibilities could not be loaded. Reload the page.",
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
