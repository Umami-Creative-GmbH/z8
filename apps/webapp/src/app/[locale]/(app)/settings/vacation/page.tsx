import { IconCalendar } from "@tabler/icons-react";
import { Suspense } from "react";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { EmployeeSickNoteSetting } from "@/components/settings/vacation/employee-sick-note-setting";
import { ProrationNotice } from "@/components/settings/vacation/proration-notice";
import { VacationManagement } from "@/components/settings/vacation/vacation-management";
import { VacationPoliciesTable } from "@/components/settings/vacation/vacation-policies-table";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { loadAbsenceSettings } from "@/lib/absences/absence-settings";
import { ensureDefaultAbsenceCategoriesForOrganization } from "@/lib/absences/default-absence-categories";
import { loadProrationNoticeForPage } from "@/lib/absences/proration-notice-store";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { isPersonnelFilesEnabled } from "@/lib/personnel-file/access-store";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getTranslate } from "@/tolgee/server";

async function VacationSettingsContent() {
	const [t, settingsRouteContext] = await Promise.all([
		getTranslate(),
		getCurrentSettingsRouteContext(),
	]);

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		return redirectWithLocale("/settings");
	}

	const organizationId =
		settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/settings");
	}

	const canManagePolicies = settingsRouteContext.accessTier === "orgAdmin";

	// Owners and admins only: managers can open this page too (#1112).
	const [absenceSettings, personnelFilesEnabled, , prorationNotice] = canManagePolicies
		? await Promise.all([
				loadAbsenceSettings(db, organizationId),
				isPersonnelFilesEnabled(db, organizationId),
				ensureDefaultAbsenceCategoriesForOrganization(organizationId),
				loadProrationNoticeForPage(db, { organizationId }),
			])
		: [null, false, undefined, null];

	const allowedAssignmentTypes = canManagePolicies
		? (["team", "employee"] as const)
		: (["employee"] as const);

	return (
		<VacationManagement
			organizationId={organizationId}
			allowedAssignmentTypes={allowedAssignmentTypes}
			canManageCategories={canManagePolicies}
			notice={
				prorationNotice?.length ? <ProrationNotice rows={prorationNotice} /> : null
			}
			absenceSettings={
				absenceSettings ? (
					<EmployeeSickNoteSetting
						enabled={absenceSettings.employeeSickNoteUpload}
						personnelFilesEnabled={personnelFilesEnabled}
					/>
				) : null
			}
		>
			<div className="grid gap-4">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconCalendar className="size-5" />
							{t("settings.vacation.vacationPolicies", "Vacation Policies")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.vacation.createDifferentPoliciesForVariousTeamsOrEmployeeGroups",
								"Create different policies for various teams or employee groups",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<VacationPoliciesTable
							organizationId={organizationId}
							canManagePolicies={canManagePolicies}
						/>
					</CardContent>
				</Card>
			</div>
		</VacationManagement>
	);
}

function VacationSettingsLoading() {
	return (
		<SettingsPageSkeleton
			variant="list"
			label={{
				labelKey: "common.loadingRegions.vacationSettings",
				labelDefault: "Loading vacation settings",
			}}
		/>
	);
}

export default function VacationSettingsPage() {
	return (
		<Suspense fallback={<VacationSettingsLoading />}>
			<VacationSettingsContent />
		</Suspense>
	);
}
