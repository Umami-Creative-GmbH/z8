import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EquipmentRefreshButton } from "@/components/equipment/equipment-header-actions";
import { parseEquipmentListQuery } from "@/components/equipment/equipment-list-state";
import { EquipmentLoading } from "@/components/equipment/equipment-loading";
import { EquipmentOverviewHeader } from "@/components/equipment/equipment-overview-header";
import { EquipmentOverview } from "@/components/equipment/equipment-workspace";
import { getEquipmentOverview } from "@/lib/organization/equipment/actions";
import { getTranslate } from "@/tolgee/server";

type Query = Record<string, string | string[] | undefined>;

/**
 * The staff Equipment overview (#1572). It reads every assignment in the reader's
 * scope; the URL filters (`holderId`, `typeId`, `outstanding`, `overdue`,
 * `former`) narrow the list on the page, so the key figures always cover the
 * whole scope.
 */
async function EquipmentContent({
	searchParams,
}: {
	searchParams: Promise<Query>;
}) {
	const [t, query, result] = await Promise.all([
		getTranslate(),
		searchParams,
		getEquipmentOverview({}),
	]);
	if (!result.success && result.code === "AuthorizationError") notFound();
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{result.success ? (
				<EquipmentOverview
					data={result.data}
					query={parseEquipmentListQuery(query)}
				/>
			) : (
				<>
					<EquipmentOverviewHeader />
					<div className="mx-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5 lg:mx-6">
						<p role="alert" className="text-sm text-destructive">
							{t(
								"settings.equipment.overview.failed",
								"Equipment could not be loaded. Reload the page to try again.",
							)}
						</p>
						<EquipmentRefreshButton>
							{t("settings.equipment.custody.reload", "Reload equipment")}
						</EquipmentRefreshButton>
					</div>
				</>
			)}
		</div>
	);
}

export default function EquipmentPage({
	searchParams,
}: {
	searchParams: Promise<Query>;
}) {
	return (
		<Suspense fallback={<EquipmentLoading variant="overview" />}>
			<EquipmentContent searchParams={searchParams} />
		</Suspense>
	);
}
