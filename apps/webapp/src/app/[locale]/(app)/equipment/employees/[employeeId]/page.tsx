import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EquipmentLoading } from "@/components/equipment/equipment-loading";
import { EmployeeEquipment } from "@/components/equipment/equipment-workspace";
import { getEmployeeEquipment } from "@/lib/organization/equipment/actions";
import { getTranslate } from "@/tolgee/server";

/** One employee's equipment; an out-of-scope, revoked or invalid employee reads as not found. */
async function EquipmentEmployeeContent({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	const { employeeId } = await params;
	const [result, t] = await Promise.all([
		getEmployeeEquipment(employeeId),
		getTranslate(),
	]);
	if (
		!result.success &&
		(result.code === "AuthorizationError" || result.code === "ValidationError")
	)
		notFound();
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{result.success ? (
				<EmployeeEquipment
					data={result.data}
					employeeId={employeeId}
					variant="page"
				/>
			) : (
				<div className="space-y-2 px-4 lg:px-6">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.equipment.employee.title", "Employee equipment")}
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
export default function EquipmentEmployeePage(props: {
	params: Promise<{ employeeId: string }>;
}) {
	return (
		<Suspense fallback={<EquipmentLoading variant="employee" />}>
			<EquipmentEmployeeContent {...props} />
		</Suspense>
	);
}
