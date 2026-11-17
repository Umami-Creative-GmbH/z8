import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isValidLoginEmail, validateLoginCredentials } from "./login-state";

describe("validateLoginCredentials", () => {
	it("accepts an email and a non-empty password", () => {
		expect(validateLoginCredentials({ email: "person@example.com", password: "x" })).toEqual({});
	});

	it("reports each invalid field with its message", () => {
		expect(validateLoginCredentials({ email: "not-an-email", password: "" })).toEqual({
			email: "Invalid email address",
			password: "Password is required",
		});
	});

	it("matches zod's email check", () => {
		for (const value of [
			"person@example.com",
			"first.last+tag@sub.example.co",
			"o'brien@example.de",
			"",
			"person@",
			"@example.com",
			".person@example.com",
			"per..son@example.com",
			"person@example",
			"person@-example.com",
			"person @example.com",
		]) {
			expect(isValidLoginEmail(value), value).toBe(z.email().safeParse(value).success);
		}
	});
});
