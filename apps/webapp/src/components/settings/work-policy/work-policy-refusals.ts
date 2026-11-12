import type { RefusalOverrides } from "@/lib/organization-action/action-error-message";

/** A saved or duplicated work policy refused because its name is taken. */
export const WORK_POLICY_REFUSALS: RefusalOverrides = {
	ConflictError: ["settings.workPolicies.nameTaken", "A policy with this name already exists"],
};

/** A saved work policy preset refused because its name is taken. */
export const WORK_POLICY_PRESET_REFUSALS: RefusalOverrides = {
	ConflictError: [
		"settings.workPolicies.presetNameTaken",
		"A preset with this name already exists",
	],
};
