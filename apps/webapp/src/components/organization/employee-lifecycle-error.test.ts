import { describe, expect, it } from "vitest";
import { EmployeeLifecycleActionError } from "./employee-lifecycle-error";

describe("EmployeeLifecycleActionError", () => {
	it.each([
		[
			"Assign and activate another approved owner before deactivating this employee",
			"settings.employees.lifecycle.finalOwnerDeactivateGuidance",
		],
		[
			"Assign and activate another approved owner before removing this employee's access",
			"settings.employees.lifecycle.finalOwnerRemoveGuidance",
		],
		[
			"This employee is no longer an approved organization member. Re-invite them before reactivating.",
			"settings.employees.lifecycle.reinviteRequired",
		],
	] as const)("maps an exact safe message to %s", (message, translationKey) => {
		const error = new EmployeeLifecycleActionError({
			success: false,
			code: "ValidationError",
			error: message,
		});

		expect(error.guidanceTranslationKey).toBe(translationKey);
		expect(JSON.stringify(error)).not.toContain(message);
	});

	it.each([
		[
			"UNKNOWN_ERROR",
			"Assign and activate another approved owner before deactivating this employee",
		],
		[
			"ValidationError",
			"Assign and activate another approved owner before deactivating this employee; secret",
		],
	] as const)("does not expose unknown code/message combinations", (code, message) => {
		const error = new EmployeeLifecycleActionError({
			success: false,
			code,
			error: message,
		});

		expect(error.guidanceTranslationKey).toBeNull();
		expect(JSON.stringify(error)).not.toContain(message);
	});
});
