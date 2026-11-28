import { Suspense } from "react";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { db } from "@/db";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import type { EmployeeReadScope } from "@/lib/organization/employee-read-types";
import { getEmployeeEquipment } from "@/lib/organization/equipment/actions";
import { readPersonalDetails } from "@/lib/organization/personal-details/personal-details";
import type { PersonalDetailsView } from "@/lib/organization/personal-details/types";
import { loadPersonnelFilePanelCapability } from "@/lib/personnel-file/panel";
import { employeeDisplayNames } from "@/lib/statutory/employee-display-names";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";
import { type EmployeeDetailRecord, getEmployee } from "../actions";
import { EmployeeDetailPageClient } from "./employee-detail-page-client";
import { EmployeePersonalDetailsPage } from "./employee-personal-details-page";

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

	if (!caller?.settingsAccess) {
		return redirectWithLocale("/settings");
	}
	const { organizationId, userId: currentUserId, settingsAccess } = caller;

	if (!meetsSettingsAccess(settingsAccess, "scopedManager")) {
		// Below scoped manager the employee record stays closed; a covering payroll
		// access holder still decides the employee's personal details (#2071).
		const personalDetails = await readPersonalDetails({
			organizationId,
			actorUserId: currentUserId,
			employeeId,
		});
		if (!decides(personalDetails)) return redirectWithLocale("/settings");
		return personalDetailsOnly(organizationId, personalDetails);
	}

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
		// A manager outside the employee's scope may still hold a covering payroll access grant.
		if (decides(personalDetails)) return personalDetailsOnly(organizationId, personalDetails);
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

/** Whether the viewer decides these personal details: never for their own. */
function decides(view: PersonalDetailsView | null): view is PersonalDetailsView {
	return view?.viewer.mayChange === true;
}

/** The employee page reduced to the personal details the module lets the viewer decide. */
async function personalDetailsOnly(organizationId: string, view: PersonalDetailsView) {
	const names = await employeeDisplayNames(db, organizationId, [view.employeeId]);
	return (
		<EmployeePersonalDetailsPage
			organizationId={organizationId}
			employeeName={names.get(view.employeeId) ?? ""}
			view={view}
		/>
	);
}
