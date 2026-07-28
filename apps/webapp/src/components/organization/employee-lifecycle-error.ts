import type { ServerActionResult } from "@/lib/effect/result";

const guidanceTranslationKeys = {
	"Assign and activate another approved owner before deactivating this employee":
		"settings.employees.lifecycle.finalOwnerDeactivateGuidance",
	"Assign and activate another approved owner before removing this employee's access":
		"settings.employees.lifecycle.finalOwnerRemoveGuidance",
	"This employee is no longer an approved organization member. Re-invite them before reactivating.":
		"settings.employees.lifecycle.reinviteRequired",
} as const;

export type EmployeeLifecycleGuidanceTranslationKey =
	(typeof guidanceTranslationKeys)[keyof typeof guidanceTranslationKeys];

function getGuidanceTranslationKey(
	result: Exclude<ServerActionResult<void>, { success: true }>,
): EmployeeLifecycleGuidanceTranslationKey | null {
	if (result.code !== "ValidationError") return null;
	return Object.hasOwn(guidanceTranslationKeys, result.error)
		? guidanceTranslationKeys[
				result.error as keyof typeof guidanceTranslationKeys
			]
		: null;
}

export class EmployeeLifecycleActionError extends Error {
	readonly guidanceTranslationKey: EmployeeLifecycleGuidanceTranslationKey | null;

	constructor(result: Exclude<ServerActionResult<void>, { success: true }>) {
		super("Employee lifecycle action failed");
		this.name = "EmployeeLifecycleActionError";
		this.guidanceTranslationKey = getGuidanceTranslationKey(result);
	}
}
