import { describe, expect, it } from "vitest";
import { initialLoginState, loginReducer } from "./login-state";

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
