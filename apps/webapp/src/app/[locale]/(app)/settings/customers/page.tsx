import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { CustomerManagement } from "@/components/settings/customer-management";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function CustomerSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage customers" />
			</div>
		);
	}

	// Only admins can access customer settings
	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	return <CustomerManagement organizationId={authContext.employee.organizationId} />;
}
