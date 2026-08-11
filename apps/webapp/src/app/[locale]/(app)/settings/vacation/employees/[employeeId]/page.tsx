import { Suspense } from "react";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { EmployeeAllowanceEditPageClient } from "./employee-allowance-edit-page-client";

export default function EmployeeAllowanceEditPage({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	return (
		<Suspense fallback={<SettingsContentLoading />}>
			<EmployeeAllowanceEditPageClient params={params} />
		</Suspense>
	);
}
