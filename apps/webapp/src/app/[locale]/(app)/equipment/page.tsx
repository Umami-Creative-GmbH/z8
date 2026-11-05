import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EquipmentOverview } from "@/components/equipment/equipment-workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { getEquipmentOverview } from "@/lib/organization/equipment/actions";
import { equipmentFiltersSchema } from "@/lib/organization/equipment/contracts";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

type Query = Record<string, string | string[] | undefined>;
function readFilterQuery(query: Query) {
	const input: Record<string, unknown> = {};
	for (const key of [
		"holderId",
		"typeId",
		"outstanding",
		"overdue",
		"former",
	] as const) {
		const value = query[key];
		if (!value) continue;
		input[key] =
			key === "holderId" || key === "typeId"
				? value
				: parseBooleanFilter(value);
	}
	return input;
}
function parseBooleanFilter(value: string | string[]) {
	if (value === "true") return true;
	if (value === "false") return false;
	return value;
}
async function EquipmentContent({
	searchParams,
}: {
	searchParams: Promise<Query>;
}) {
	const translating = getTranslate();
	const query = await searchParams;
	const input = readFilterQuery(query);
	const parsed = equipmentFiltersSchema.safeParse(input);
	const [t, result] = await Promise.all([
		translating,
		getEquipmentOverview(parsed.success ? parsed.data : input),
	]);
	if (!result.success && result.code === "AuthorizationError") notFound();
	return (
		<div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
			<h1 className="text-2xl font-semibold tracking-tight">
				{t("settings.equipment.overview.title", "Equipment overview")}
			</h1>
			{result.success && parsed.success ? (
				<EquipmentOverview data={result.data} filters={parsed.data} />
			) : (
				<div role="alert" className="space-y-2 text-sm">
					<p>
						{t(
							"settings.equipment.overview.failed",
							"Equipment could not be loaded. Clear invalid filters or reload the page.",
						)}
					</p>
					<Link href="/equipment" className="text-primary underline">
						{t("settings.equipment.filters.clear", "Clear filters")}
					</Link>
				</div>
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
		<Suspense
			fallback={
				<div className="p-6">
					<Skeleton className="h-96 w-full" />
				</div>
			}
		>
			<EquipmentContent searchParams={searchParams} />
		</Suspense>
	);
}
