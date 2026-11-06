import { IconPackage } from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EquipmentOfficers } from "@/components/settings/equipment/equipment-officers";
import {
	EquipmentLoadError,
	EquipmentRefreshButton,
} from "@/components/settings/equipment/equipment-page-actions";
import { EquipmentSettings } from "@/components/settings/equipment/equipment-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { isEquipmentEnabled } from "@/lib/organization/equipment/access";
import {
	getEquipmentOfficerGrants,
	getEquipmentSetup,
} from "@/lib/organization/equipment/actions";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

async function EquipmentSettingsContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	if (!(await isEquipmentEnabled(db, organizationId))) notFound();
	const [t, result, officers] = await Promise.all([
		getTranslate(),
		getEquipmentSetup(),
		getEquipmentOfficerGrants(),
	]);
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0 space-y-1">
					<h1 className="text-2xl font-semibold">
						{t("settings.equipment.title", "Equipment")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.equipment.description",
							"Configure equipment types, item identities and record retention.",
						)}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<EquipmentRefreshButton />
					<Button asChild variant="outline">
						<Link href="/equipment">
							<IconPackage className="size-4" aria-hidden="true" />
							{t("settings.equipment.openOverview", "Open equipment overview")}
						</Link>
					</Button>
				</div>
			</div>
			{result.success ? (
				<EquipmentSettings key={organizationId} initialData={result.data} />
			) : (
				<EquipmentLoadError
					title={t(
						"settings.equipment.errors.loadTitle",
						"Equipment setup could not be loaded",
					)}
					description={t(
						"settings.equipment.errors.loadRetry",
						"Check your organization access, then try again.",
					)}
				/>
			)}
			{officers.success ? (
				<EquipmentOfficers data={officers.data} />
			) : (
				<EquipmentLoadError
					title={t(
						"settings.equipment.officers.loadTitle",
						"Equipment officers could not be loaded",
					)}
					description={t(
						"settings.equipment.officers.loadRetry",
						"Equipment responsibilities are unavailable right now. Try again.",
					)}
				/>
			)}
		</div>
	);
}

const SKELETON_ROWS = ["first", "second", "third"] as const;

function SkeletonCard({ rows }: { rows: number }) {
	return (
		<Card>
			<CardHeader>
				<Skeleton aria-hidden="true" className="h-5 w-48" />
				<Skeleton aria-hidden="true" className="h-4 w-full max-w-xl" />
			</CardHeader>
			<CardContent>
				<div className="divide-y rounded-lg border">
					{SKELETON_ROWS.slice(0, rows).map((row) => (
						<div
							key={row}
							className="flex items-center justify-between gap-4 p-4"
						>
							<Skeleton aria-hidden="true" className="h-4 w-40" />
							<Skeleton aria-hidden="true" className="h-5 w-24 rounded-md" />
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

function EquipmentSettingsLoading() {
	return (
		<LoadingRegion
			className="flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
			label={{
				labelKey: "settings.equipment.loading",
				labelDefault: "Loading equipment settings",
			}}
		>
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-2">
					<Skeleton aria-hidden="true" className="h-8 w-40" />
					<Skeleton aria-hidden="true" className="h-5 w-full max-w-md" />
				</div>
				<div className="flex gap-2">
					<Skeleton aria-hidden="true" className="size-9" />
					<Skeleton aria-hidden="true" className="h-9 w-52" />
				</div>
			</div>
			<Card>
				<CardHeader>
					<Skeleton aria-hidden="true" className="h-5 w-40" />
					<Skeleton aria-hidden="true" className="h-4 w-full max-w-xl" />
				</CardHeader>
				<CardContent>
					<Skeleton aria-hidden="true" className="h-16 w-full" />
				</CardContent>
			</Card>
			<SkeletonCard rows={3} />
			<SkeletonCard rows={3} />
			<SkeletonCard rows={2} />
		</LoadingRegion>
	);
}

export default function EquipmentSettingsPage() {
	return (
		<Suspense fallback={<EquipmentSettingsLoading />}>
			<EquipmentSettingsContent />
		</Suspense>
	);
}
