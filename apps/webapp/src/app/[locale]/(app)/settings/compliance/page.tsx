import type { Metadata } from "next";
import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ComplianceExceptionsManager } from "@/components/settings/compliance-exceptions-manager";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getTranslate } from "@/tolgee/server";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslate();

	return {
		title: t("settings.compliance.metadata.title", "Compliance Settings | ArbZG"),
		description: t(
			"settings.compliance.metadata.description",
			"Configure ArbZG compliance settings and manage exception requests",
		),
	};
}

async function ComplianceSettingsContent() {
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		const t = await getTranslate();
		return (
			<div className="page-frame">
				<div className="page-measure space-y-6">
					<PageHeader title={t("settings.compliance.title", "ArbZG Compliance")} />
					<NoEmployeeError
						feature="manage compliance settings"
						className="w-full max-w-xl"
					/>
				</div>
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
		<div className="page-frame" aria-busy="true">
			<div className="page-measure space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56 max-w-full" aria-hidden="true" />
					<Skeleton className="h-5 w-80 max-w-full" aria-hidden="true" />
				</div>
				<Skeleton className="h-[360px] w-full" aria-hidden="true" />
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
