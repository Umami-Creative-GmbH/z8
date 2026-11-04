import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmployeeEquipment } from "@/components/equipment/equipment-workspace";
import { getEmployeeEquipment } from "@/lib/organization/equipment/actions";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

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
		<div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
			<h1 className="text-2xl font-semibold tracking-tight">
				{t("settings.equipment.employee.title", "Employee equipment")}
			</h1>
			<Link
				href="/equipment"
				className="text-sm text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
			>
				{t("settings.equipment.openOverview", "Open equipment overview")}
			</Link>
			{result.success ? (
				<EmployeeEquipment data={result.data} employeeId={employeeId} />
			) : (
				<p role="alert">
					{t(
						"settings.equipment.overview.failed",
						"Equipment could not be loaded. Reload the page to try again.",
					)}
				</p>
			)}
		</div>
	);
}
export default function EquipmentEmployeePage(props: {
	params: Promise<{ employeeId: string }>;
}) {
	return (
		<Suspense>
			<EquipmentEmployeeContent {...props} />
		</Suspense>
	);
}
