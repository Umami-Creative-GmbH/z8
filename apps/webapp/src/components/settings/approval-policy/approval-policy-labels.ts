import type { useTranslate } from "@tolgee/react";
import type {
	ApprovalPolicyApproverType,
	ApprovalPolicyFallbackBehavior,
} from "./approval-policy-dialog-utils";

export type ApprovalPolicyTranslate = ReturnType<typeof useTranslate>["t"];

export function approverTypeLabel(
	value: ApprovalPolicyApproverType,
	t: ApprovalPolicyTranslate,
): string {
	switch (value) {
		case "direct_manager":
			return t(
				"settings.approvalPolicies.approverType.directManager",
				"Direct manager",
			);
		case "manager_manager":
			return t(
				"settings.approvalPolicies.approverType.managerManager",
				"Manager's manager",
			);
		case "org_admin":
			return t(
				"settings.approvalPolicies.approverType.organizationAdmin",
				"Organization admin",
			);
		case "specific_employee":
			return t(
				"settings.approvalPolicies.approverType.specificEmployee",
				"Specific employee",
			);
	}
}

export function fallbackBehaviorLabel(
	value: ApprovalPolicyFallbackBehavior,
	t: ApprovalPolicyTranslate,
): string {
	switch (value) {
		case "fail":
			return t(
				"settings.approvalPolicies.fallbackBehavior.fail.label",
				"Fail request",
			);
		case "default_manager":
			return t(
				"settings.approvalPolicies.fallbackBehavior.defaultManager.label",
				"Default manager",
			);
		case "organization_admin":
			return t(
				"settings.approvalPolicies.fallbackBehavior.organizationAdmin.label",
				"Organization admin",
			);
	}
}

/** The first characters of an ID, enough to tell records apart. */
export function shortEmployeeId(employeeId: string): string {
	return employeeId.slice(0, 8);
}

export function unknownEmployeeLabel(
	employeeId: string,
	t: ApprovalPolicyTranslate,
): string {
	return t(
		"settings.approvalPolicies.unknownEmployee",
		"Unknown employee ({shortId})",
		{ shortId: shortEmployeeId(employeeId) },
	);
}
