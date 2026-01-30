import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { LocationDetail } from "@/components/settings/location-detail";
import { getAuthContext } from "@/lib/auth-helpers";

interface LocationDetailPageProps {
	params: Promise<{ locationId: string }>;
}

export default async function LocationDetailPage({ params }: LocationDetailPageProps) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const { locationId } = await params;
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

	return (
		<LocationDetail locationId={locationId} organizationId={authContext.employee.organizationId} />
	);
}
