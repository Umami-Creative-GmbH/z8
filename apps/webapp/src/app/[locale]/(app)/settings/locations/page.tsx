import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { LocationManagement } from "@/components/settings/location-management";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function LocationSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage locations" />
			</div>
		);
	}

	// Only admins can access location settings
	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	return <LocationManagement organizationId={authContext.employee.organizationId} />;
}
