import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ComplianceExceptionsManager } from "@/components/settings/compliance-exceptions-manager";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

export const metadata = {
	title: "Compliance Settings | ArbZG",
	description:
		"Configure ArbZG compliance settings and manage exception requests",
};

async function ComplianceSettingsContent() {
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage compliance settings" />
			</div>
		);
	}

	// Only managers and admins can access compliance exception management
	if (authContext.employee.role === "employee") {
		return redirectWithLocale("/");
	}

	return (
		<ComplianceExceptionsManager
			organizationId={authContext.employee.organizationId}
			employeeId={authContext.employee.id}
			isAdmin={authContext.employee.role === "admin"}
		/>
	);
}

function ComplianceSettingsLoading() {
	return (
		<div className="p-6">
			<div className="mx-auto max-w-4xl space-y-4">
				<Skeleton className="h-8 w-56" />
				<Skeleton className="h-5 w-80" />
				<Skeleton className="h-[360px] w-full" />
			</div>
		</div>
	);
}

export default function ComplianceSettingsPage() {
	return (
		<Suspense fallback={<ComplianceSettingsLoading />}>
			<ComplianceSettingsContent />
		</Suspense>
	);
}
