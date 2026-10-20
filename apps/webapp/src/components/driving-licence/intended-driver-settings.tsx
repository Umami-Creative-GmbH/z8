"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ScopedFeatureAssignments } from "@/components/settings/scoped-feature-assignments";
import {
	removeDrivingLicenceIntendedDriverAssignmentAction,
	setDrivingLicenceIntendedDriverAssignmentAction,
} from "@/lib/organization/driving-licence/intended-driver-actions";
import type {
	IntendedDriverAdminData,
	IntendedDriverRequirement,
} from "@/lib/organization/driving-licence/intended-driver-rules";

type Translate = ReturnType<typeof useTranslate>["t"];

function refusalMessage(t: Translate, error: string) {
	switch (error) {
		case "forbidden":
			return t(
				"drivingLicence.intendedDrivers.error.forbidden",
				"Only organization owners and admins can assign intended drivers.",
			);
		case "not_enabled":
			return t(
				"drivingLicence.intendedDrivers.error.notEnabled",
				"Switch on driving licence control before assigning intended drivers.",
			);
		case "team_not_found":
			return t("drivingLicence.intendedDrivers.error.teamNotFound", "That team no longer exists.");
		case "employee_not_found":
			return t(
				"drivingLicence.intendedDrivers.error.employeeNotFound",
				"That employee is no longer a current employee of this organization.",
			);
		case "assignment_not_found":
			return t(
				"drivingLicence.intendedDrivers.error.assignmentNotFound",
				"That assignment no longer exists. Reload the page.",
			);
		default:
			return t(
				"drivingLicence.intendedDrivers.error.failed",
				"The intended drivers could not be saved. Try again.",
			);
	}
}

/**
 * Intended drivers (#1423): Required / Not required for the whole organization, a primary
 * team or one employee, in the shared scoped-assignment cards. Saves apply at once.
 */
export function IntendedDriverSettings({ data }: { data: IntendedDriverAdminData }) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const applied = (message: string) => {
		toast.success(message);
		void queryClient.invalidateQueries({ queryKey: ["driving-authorization-status"] });
		router.refresh();
		return true;
	};
	const options: { value: IntendedDriverRequirement; label: string }[] = [
		{ value: "required", label: t("drivingLicence.intendedDrivers.required", "Required") },
		{
			value: "not_required",
			label: t("drivingLicence.intendedDrivers.notRequired", "Not required (excluded)"),
		},
	];
	return (
		<section aria-labelledby="driving-intended-drivers-title" className="space-y-4">
			<h2 id="driving-intended-drivers-title" className="text-lg font-semibold">
				{t("drivingLicence.intendedDrivers.title", "Intended drivers")}
			</h2>
			<ScopedFeatureAssignments
				assignments={data.assignments}
				teams={data.teams}
				employees={data.employees}
				options={options}
				valueLabel={t("drivingLicence.intendedDrivers.valueLabel", "Driving licence checks")}
				organizationLabel={t(
					"drivingLicence.intendedDrivers.targetOrganization",
					"Whole organization",
				)}
				description={t(
					"drivingLicence.intendedDrivers.description",
					"Intended drivers get original licence checks, reminders and a driving status. Nobody is an intended driver until you assign them. The most specific assignment wins: an employee's own over their primary team's, and a team's over the whole organization's. Other team memberships don't count. Not required excludes a team or employee from a broader assignment.",
				)}
				onSave={async (target, value) => {
					const result = await setDrivingLicenceIntendedDriverAssignmentAction({ target, value });
					if (!result.success) {
						toast.error(refusalMessage(t, result.error));
						return false;
					}
					return applied(t("drivingLicence.intendedDrivers.saved", "Intended drivers saved"));
				}}
				onRemove={async (assignmentId) => {
					const result = await removeDrivingLicenceIntendedDriverAssignmentAction({ assignmentId });
					if (!result.success) {
						toast.error(refusalMessage(t, result.error));
						return false;
					}
					return applied(
						t("drivingLicence.intendedDrivers.removed", "Intended driver assignment removed"),
					);
				}}
			/>
		</section>
	);
}
