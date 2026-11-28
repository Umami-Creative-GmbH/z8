import { eq } from "drizzle-orm";
import { OwnCustomFieldsCard } from "@/components/settings/custom-fields/own-custom-fields-card";
import { ApprenticeReleaseCard } from "@/components/settings/employees/apprentice-release-card";
import { OwnSkillsCard } from "@/components/settings/own-skills-card";
import { OwnWorkingStudentCard } from "@/components/settings/own-working-student-card";
import { OwnPersonalDetailsCard } from "@/components/settings/personal-details/own-personal-details-card";
import { ProfileForm } from "@/components/settings/profile-form";
import { TimeFormatSettings } from "@/components/settings/time-format-settings";
import { TimezoneSettings } from "@/components/settings/timezone-settings";
import { OnCallStatusCard } from "@/components/statutory/on-call/on-call-status-card";
import { WeekStartSettings } from "@/components/settings/week-start-settings";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { systemClock } from "@/lib/datetime/temporal-core";
import { readPersonalDetails } from "@/lib/organization/personal-details/personal-details";
import { loadOwnSkills } from "@/lib/scheduling/own-skills";
import { loadOwnWorkingStudentStatus } from "@/lib/statutory/working-student/views";
import { getTranslate } from "@/tolgee/server";
import { getOwnCustomFieldValues } from "../custom-fields/value-actions";
import {
	getCurrentTimezone,
	getTimeFormat,
	getWeekStartDay,
	updateTimeFormat,
	updateTimezone,
	updateWeekStartDay,
} from "./actions";

export default async function ProfilePage() {
	// Parallelize auth, timezone, and translation fetches
	const [authContext, currentTimezone, currentWeekStartDay, currentTimeFormat, t, ownCustomFields] =
		await Promise.all([
			requireUser(),
			getCurrentTimezone(),
			getWeekStartDay(),
			getTimeFormat(),
			getTranslate(),
			getOwnCustomFieldValues(),
		]);
	const ownEmployee = authContext.employee;
	const [settings, ownSkills, ownWorkingStudent, ownPersonalDetails] = await Promise.all([
		db.query.userSettings.findFirst({
			where: eq(userSettings.userId, authContext.user.id),
			columns: { helpImproveProduct: true },
		}),
		// Skill expiry reminders link the employee here (#1143).
		ownEmployee
			? loadOwnSkills(db, {
					organizationId: ownEmployee.organizationId,
					employeeId: ownEmployee.id,
					now: systemClock.nowInstant(),
				})
			: null,
		// #1991: only the signed-in employee's own, non-sensitive status.
		ownEmployee
			? loadOwnWorkingStudentStatus(db, {
					organizationId: ownEmployee.organizationId,
					employeeId: ownEmployee.id,
					now: systemClock.nowInstant(),
				})
			: null,
		// Their own bank account, in full and read-only (#2069).
		ownEmployee
			? readPersonalDetails({
					organizationId: ownEmployee.organizationId,
					actorUserId: authContext.user.id,
					employeeId: ownEmployee.id,
				})
			: null,
	]);
	const user = {
		...authContext.user,
		helpImproveProduct: settings?.helpImproveProduct ?? true,
	};

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<PageHeader
					title={t("settings.profile.title", "Profile Settings")}
					description={t(
						"settings.profile.description",
						"Manage your personal information and preferences",
					)}
				/>

				<ProfileForm user={user} />

				{ownCustomFields.success ? <OwnCustomFieldsCard section={ownCustomFields.data} /> : null}

				{ownPersonalDetails?.viewer.own ? (
					<OwnPersonalDetailsCard view={ownPersonalDetails} />
				) : null}

				{ownSkills && ownSkills.skills.length > 0 ? <OwnSkillsCard ownSkills={ownSkills} /> : null}

				{/* Own § 12 TzBfG on-call status and reference hours (#1992); nothing when never on call. */}
				{ownEmployee ? (
					<OnCallStatusCard
						organizationId={ownEmployee.organizationId}
						employeeId={ownEmployee.id}
					/>
				) : null}

				{ownWorkingStudent ? <OwnWorkingStudentCard status={ownWorkingStudent} /> : null}

				{ownEmployee ? (
					<ApprenticeReleaseCard view="self" organizationId={ownEmployee.organizationId} />
				) : null}

				<TimezoneSettings currentTimezone={currentTimezone} onUpdate={updateTimezone} />
				<WeekStartSettings
					currentWeekStartDay={currentWeekStartDay}
					onUpdate={updateWeekStartDay}
				/>
				<TimeFormatSettings currentTimeFormat={currentTimeFormat} onUpdate={updateTimeFormat} />
			</div>
		</div>
	);
}
