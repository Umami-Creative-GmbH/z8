import { describe, expect, it } from "vitest";
import { validatePasswordConfirmation, validateStrongPassword } from "./password-validation";

const t = (_key: string, fallback: string) => fallback;

describe("password validation", () => {
	it("requires strong passwords", () => {
		expect(validateStrongPassword("short", t)).toBe("Password must be at least 12 characters");
		expect(validateStrongPassword("longpassword1", t)).toBe(
			"Password must contain at least one uppercase letter",
		);
		expect(validateStrongPassword("Longpassword1", t)).toBeUndefined();
	});

	it("requires matching confirmation", () => {
		expect(validatePasswordConfirmation("", "Longpassword1", t)).toBe(
			"Please confirm your password",
		);
		expect(validatePasswordConfirmation("Different1", "Longpassword1", t)).toBe(
			"Passwords do not match",
		);
		expect(validatePasswordConfirmation("Longpassword1", "Longpassword1", t)).toBeUndefined();
	});
});
