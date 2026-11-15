import { Suspense } from "react";
import {
	ComplianceCommandCenterPage,
	CompliancePageLoading,
} from "@/components/compliance-command-center/compliance-command-center-page";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getComplianceCommandCenterData } from "@/lib/compliance-command-center/loader";

export const metadata = {
	title: "Compliance",
	description: "Risk-first compliance overview for organization admins",
};

async function CompliancePageContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();
	const data = await getComplianceCommandCenterData(organizationId);

	return <ComplianceCommandCenterPage data={data} />;
}

export default function CompliancePage() {
	return (
		<Suspense fallback={<CompliancePageLoading />}>
			<CompliancePageContent />
		</Suspense>
	);
}
