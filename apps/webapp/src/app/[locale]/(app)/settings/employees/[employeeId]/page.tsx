import { Suspense } from "react";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { db } from "@/db";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import type { EmployeeReadScope } from "@/lib/organization/employee-read-types";
import { getEmployeeEquipment } from "@/lib/organization/equipment/actions";
import { readPersonalDetails } from "@/lib/organization/personal-details/personal-details";
import { loadPersonnelFilePanelCapability } from "@/lib/personnel-file/panel";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";
import { type EmployeeDetailRecord, getEmployee } from "../actions";
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

async function EmployeeDetailPageContent({ params, searchParams }: EmployeeDetailPageProps) {
	const [caller, { employeeId }, query] = await Promise.all([
		getCurrentSettingsAccess(),
		params,
		searchParams ?? Promise.resolve({ review: undefined }),
	]);
	// A notification links to one persisted review; only its id is passed on.
	const highlightedReviewId = isCanonicalUuid(query.review) ? query.review : null;

	if (!caller?.settingsAccess || !meetsSettingsAccess(caller.settingsAccess, "scopedManager")) {
		return redirectWithLocale("/settings");
	}
	const { organizationId, userId: currentUserId, settingsAccess } = caller;

	const [employeeResult, personnelFile, equipment, organizationTimezone, personalDetails] =
		await Promise.all([
			getEmployee(employeeId),
			// Decided by the personnel file access resolver, never by settings access:
			// managers reach this page but not the personnel file (#865, ADR 0001).
			loadPersonnelFilePanelCapability(employeeId),
			// Equipment authority is independent of settings access and manager role.
			getEmployeeEquipment(employeeId),
			loadOrganizationTimezone(db, organizationId),
			// Decided by the personal details module alone: managers reach this page but
			// never an employee's bank account (#2069, spec #2068).
			readPersonalDetails({ organizationId, actorUserId: currentUserId, employeeId }),
		]);

	if (!employeeResult.success || employeeResult.data.organizationId !== organizationId) {
		return redirectWithLocale("/settings/employees");
	}

	return (
		<EmployeeDetailPageClient
			params={Promise.resolve({ employeeId })}
			currentUserId={currentUserId}
			organizationId={organizationId}
			organizationTimezone={organizationTimezone}
			initialSnapshot={snapshotDetail(
				{ userId: currentUserId, organizationId },
				employeeResult.data,
			)}
			settingsAccess={settingsAccess}
			highlightedReviewId={highlightedReviewId}
			personnelFile={personnelFile}
			equipment={equipment.success ? equipment.data : null}
			personalDetails={personalDetails}
		/>
	);
}
