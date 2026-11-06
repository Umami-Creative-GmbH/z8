import { notFound } from "next/navigation";
import { Suspense } from "react";
import { equipmentReturnPath } from "@/components/equipment/equipment-list-state";
import { EquipmentLoading } from "@/components/equipment/equipment-loading";
import { EquipmentAssignmentDetail } from "@/components/equipment/equipment-workspace";
import { getEquipmentAssignment } from "@/lib/organization/equipment/actions";
import { getTranslate } from "@/tolgee/server";

type Props = {
	params: Promise<{ assignmentId: string }>;
	/** `back`: the list it was opened from, with its filters (validated). */
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * One assignment (#1572). Another organization's, an out-of-scope or a missing
 * assignment, an invalid reference, and equipment switched off all read as not found.
 */
async function AssignmentContent({ params, searchParams }: Props) {
	const [{ assignmentId }, query] = await Promise.all([params, searchParams]);
	const [t, result] = await Promise.all([
		getTranslate(),
		getEquipmentAssignment(assignmentId),
	]);
	if (
		!result.success &&
		(result.code === "AuthorizationError" || result.code === "ValidationError")
	)
		notFound();
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{result.success ? (
				<EquipmentAssignmentDetail
					data={result.data}
					back={equipmentReturnPath(query.back)}
				/>
			) : (
				<div className="space-y-2 px-4 lg:px-6">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.equipment.title", "Equipment")}
					</h1>
					<p role="alert" className="text-sm text-destructive">
						{t(
							"settings.equipment.overview.failed",
							"Equipment could not be loaded. Reload the page to try again.",
						)}
					</p>
				</div>
			)}
		</div>
	);
}

export default function EquipmentAssignmentPage(props: Props) {
	return (
		<Suspense fallback={<EquipmentLoading variant="detail" />}>
			<AssignmentContent {...props} />
		</Suspense>
	);
}
