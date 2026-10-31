import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	initialLoginState,
	isValidLoginEmail,
	loginReducer,
	validateLoginCredentials,
} from "./login-state";

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

describe("loginReducer", () => {
	it("updates a credential and clears its field and general errors", () => {
		const state = {
			...initialLoginState,
			fieldErrors: { email: "Invalid email address", password: "Password is required" },
			error: "Sign in failed",
		};

		expect(loginReducer(state, { type: "SET_FIELD", field: "email", value: "a@b.com" })).toEqual({
			...state,
			email: "a@b.com",
			fieldErrors: { password: "Password is required" },
			error: null,
		});
	});

	it("clears loading when two-factor authentication is required", () => {
		expect(loginReducer({ ...initialLoginState, isLoading: true }, { type: "SET_REQUIRES_2FA", requires2FA: true })).toMatchObject({
			requires2FA: true,
			isLoading: false,
		});
	});
});
