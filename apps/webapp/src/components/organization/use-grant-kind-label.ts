"use client";

import { useTranslate } from "@tolgee/react";
import type { ChecklistGrantKind } from "@/lib/employee-lifecycle/reactivation-checklist";

/**
 * The name of a held grant kind, shared by the deactivation preview (what
 * ends) and the reactivation checklist (what to grant again).
 */
export function useGrantKindLabel(): (kind: ChecklistGrantKind) => string {
	const { t } = useTranslate();
	return (kind) => {
		switch (kind) {
			case "expense_officer":
				return t(
					"settings.employees.lifecycle.deactivationPreview.grants.expenseOfficer",
					"Travel expense officer",
				);
			case "payroll_access":
				return t(
					"settings.employees.lifecycle.deactivationPreview.grants.payrollAccess",
					"Payroll access",
				);
			case "personnel_file_officer":
				return t(
					"settings.employees.lifecycle.deactivationPreview.grants.personnelFileOfficer",
					"Personnel file officer",
				);
			case "driving_licence_verifier":
				return t(
					"settings.employees.lifecycle.deactivationPreview.grants.drivingLicenceVerifier",
					"Driving licence verifier",
				);
		}
	};
}
