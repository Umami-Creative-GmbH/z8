import { Suspense } from "react";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import type { EmployeeReadScope } from "@/lib/organization/employee-read-types";
import { loadPersonnelFilePanelCapability } from "@/lib/personnel-file/panel";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";
import { type EmployeeDetailRecord, getEmployee } from "../actions";
import { getCurrentApprovedMembership } from "../current-approved-membership";
import { EmployeeDetailPageClient } from "./employee-detail-page-client";

interface EmployeeDetailPageProps {
	params: Promise<{ employeeId: string }>;
	searchParams?: Promise<{ review?: string | string[] }>;
}

function snapshotDetail(scope: EmployeeReadScope, data: EmployeeDetailRecord) {
	return { scope, data, updatedAt: Date.now() };
}

export default function EmployeeDetailPage(props: EmployeeDetailPageProps) {
	return (
		<Suspense fallback={<SettingsContentLoading />}>
			<EmployeeDetailPageContent {...props} />
		</Suspense>
	);
}

async function EmployeeDetailPageContent({
	params,
	searchParams,
}: EmployeeDetailPageProps) {
	const [settingsRouteContext, { employeeId }, query] = await Promise.all([
		getCurrentSettingsRouteContext(),
		params,
		searchParams ?? Promise.resolve({ review: undefined }),
	]);
	// A notification links to one persisted review; only its id is passed on.
	const highlightedReviewId = isCanonicalUuid(query.review)
		? query.review
		: null;

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		return redirectWithLocale("/settings");
	}
	const organizationId =
		settingsRouteContext.authContext.session.activeOrganizationId;
	if (!organizationId) {
		return redirectWithLocale("/settings");
	}
	const currentUserId = settingsRouteContext.authContext.user.id;
	const currentMember = await getCurrentApprovedMembership({
		userId: currentUserId,
		organizationId,
	});

	if (!currentMember) {
		return redirectWithLocale("/settings");
	}

	const [employeeResult, personnelFile] = await Promise.all([
		getEmployee(employeeId),
		// Decided by the personnel file access resolver, never by the settings tier:
		// managers reach this page but not the personnel file (#865, ADR 0001).
		loadPersonnelFilePanelCapability(employeeId),
	]);

	if (!employeeResult.success || employeeResult.data.organizationId !== organizationId) {
		return redirectWithLocale("/settings/employees");
	}

	return (
		<EmployeeDetailPageClient
			params={Promise.resolve({ employeeId })}
			accessTier={settingsRouteContext.accessTier}
			currentUserId={currentUserId}
			organizationId={organizationId}
			initialSnapshot={snapshotDetail(
				{ userId: currentUserId, organizationId },
				employeeResult.data,
			)}
			currentMemberRole={currentMember.role}
			highlightedReviewId={highlightedReviewId}
			personnelFile={personnelFile}
		/>
	);
}
