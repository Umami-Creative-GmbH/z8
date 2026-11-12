"use client";

import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { previewEmployeeTeamChange } from "@/app/[locale]/(app)/settings/employees/actions";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
import { useDrivingLicenceTeamChangeWarning } from "@/components/driving-licence/ending-confirmation";
import type { useCustomFieldDrafts } from "@/components/settings/custom-fields/use-custom-field-drafts";
import { queryKeys } from "@/lib/query";
import type { useEmployee } from "@/lib/query/use-employee";
import type { SettingsAccessTier } from "@/lib/settings-access";
import { useRouter } from "@/navigation";
import {
	buildEmployeeDetailFormValues,
	buildEmployeeUpdatePayload,
	defaultFormValues,
	focusFirstInvalidEmployeeDetailField,
	showEmployeeSaveRefusal,
	syncEmployeeForm,
} from "./page-utils";

type EmployeeData = ReturnType<typeof useEmployee>;

/**
 * The employee details form: its Team field's options, the driving licence
 * warning a team change can raise, and the save that returns to the list.
 */
export function useEmployeeDetailForm({
	employeeId,
	accessTier,
	employee,
	updateEmployee,
	customFields,
}: {
	employeeId: string;
	accessTier: SettingsAccessTier;
	employee: EmployeeData["employee"];
	updateEmployee: EmployeeData["updateEmployee"];
	/** The "Custom fields" section (#818), saved with the employee details. */
	customFields: ReturnType<typeof useCustomFieldDrafts>;
}) {
	const { t } = useTranslate();
	const { push } = useRouter();

	// The Team field (Organization ADR 0010): org admins move a real employee between teams.
	const canEditTeam =
		accessTier === "orgAdmin" && employee?.kind === "employee";
	const teamOptions = useQuery({
		queryKey: queryKeys.teams.options(employee?.organizationId ?? ""),
		queryFn: async () => {
			const result = await listTeams(employee?.organizationId);
			if (!result.success) throw new Error(result.error);
			return result.data.map((team) => ({ id: team.id, name: team.name }));
		},
		enabled: canEditTeam,
		staleTime: 60 * 1000,
	});
	// Without its teams the Team field stays hidden: say why rather than offer none.
	const teamOptionsError = teamOptions.error;
	useEffect(() => {
		if (teamOptionsError)
			toast.error(
				teamOptionsError.message ||
					t("errors.failedToLoad", "Failed to load data"),
			);
	}, [teamOptionsError, t]);
	const { confirmTeamChange, teamChangeError, drivingLicenceWarning } =
		useDrivingLicenceTeamChangeWarning();

	const form = useForm({
		defaultValues: employee
			? buildEmployeeDetailFormValues(employee)
			: defaultFormValues,
		onSubmitInvalid: ({ formApi }) =>
			focusFirstInvalidEmployeeDetailField(formApi),
		onSubmit: async ({ value }) => {
			const payload = buildEmployeeUpdatePayload(
				value,
				canEditTeam ? (employee.teamId ?? null) : undefined,
			);
			// A new primary team can end driving authorizations: warn first (#1425).
			let drivingLicencePreviewToken: string | undefined;
			if ("teamId" in payload) {
				const previewToken = await confirmTeamChange(() =>
					previewEmployeeTeamChange({ employeeId, teamId: payload.teamId ?? null }),
				);
				if (previewToken === null) return;
				drivingLicencePreviewToken = previewToken;
			}
			const result = await updateEmployee({
				...payload,
				// Undefined for invitation drafts: their section is never loaded.
				customFieldValues: customFields.values(),
				drivingLicencePreviewToken,
			}).catch(() => null);

			if (!result) {
				toast.error(
					t(
						"settings.employees.detailView.unexpectedError",
						"An unexpected error occurred",
					),
				);
				return;
			}

			if (result.success) {
				toast.success(
					t(
						"settings.employees.detailView.updateSuccess",
						"Employee updated successfully",
					),
				);
				customFields.reset();
				push("/settings/employees");
			} else if (showEmployeeSaveRefusal(form, result)) {
				focusFirstInvalidEmployeeDetailField(form);
			} else {
				toast.error(
					teamChangeError(
						result,
						t(
							"settings.employees.detailView.updateFailed",
							"Failed to update employee",
						),
					),
				);
			}
		},
	});
	const syncedEmployee = useRef<string | null>(null);

	useEffect(() => {
		if (
			employee &&
			(syncedEmployee.current !== employeeId || !form.state.isDirty)
		) {
			syncEmployeeForm(form, employee);
			syncedEmployee.current = employeeId;
		}
	}, [employee, employeeId, form]);

	return {
		form,
		/** The Team field's options, only for an org admin editing a real employee. */
		teamOptions: canEditTeam ? teamOptions.data : undefined,
		drivingLicenceWarning,
	};
}
