import { z } from "zod";

export const loginSchema = z.object({
	email: z.email("Invalid email address"),
	password: z.string().min(1, "Password is required"),
});

// Consolidated form state to reduce re-renders (rerender-functional-setstate)
export type LoginState = {
	email: string;
	password: string;
	fieldErrors: Record<string, string>;
	error: string | null;
	isLoading: boolean;
	requires2FA: boolean;
	otpValue: string;
	trustDevice: boolean;
	turnstileToken: string | null;
};

export type LoginAction =
	| { type: "SET_FIELD"; field: "email" | "password"; value: string }
	| { type: "SET_FIELD_ERROR"; field: string; error: string }
	| { type: "CLEAR_FIELD_ERROR"; field: string }
	| { type: "SET_FIELD_ERRORS"; errors: Record<string, string> }
	| { type: "SET_ERROR"; error: string | null }
	| { type: "SET_LOADING"; loading: boolean }
	| { type: "SET_REQUIRES_2FA"; requires2FA: boolean }
	| { type: "SET_OTP"; value: string }
	| { type: "SET_TRUST_DEVICE"; trustDevice: boolean }
	| { type: "SET_TURNSTILE_TOKEN"; token: string | null }
	| { type: "RESET_LOADING" };

export const initialLoginState: LoginState = {
	email: "",
	password: "",
	fieldErrors: {},
	error: null,
	isLoading: false,
	requires2FA: false,
	otpValue: "",
	trustDevice: false,
	turnstileToken: null,
};

export function loginReducer(state: LoginState, action: LoginAction): LoginState {
	switch (action.type) {
		case "SET_FIELD": {
			const newFieldErrors = { ...state.fieldErrors };
			delete newFieldErrors[action.field];
			return {
				...state,
				[action.field]: action.value,
				fieldErrors: newFieldErrors,
				error: null, // Clear general error when typing
			};
		}
		case "SET_FIELD_ERROR":
			return {
				...state,
				fieldErrors: { ...state.fieldErrors, [action.field]: action.error },
			};
		case "CLEAR_FIELD_ERROR": {
			const newFieldErrors = { ...state.fieldErrors };
			delete newFieldErrors[action.field];
			return { ...state, fieldErrors: newFieldErrors };
		}
		case "SET_FIELD_ERRORS":
			return { ...state, fieldErrors: action.errors };
		case "SET_ERROR":
			return { ...state, error: action.error };
		case "SET_LOADING":
			return { ...state, isLoading: action.loading };
		case "SET_REQUIRES_2FA":
			return { ...state, requires2FA: action.requires2FA, isLoading: false };
		case "SET_OTP":
			return { ...state, otpValue: action.value };
		case "SET_TRUST_DEVICE":
			return { ...state, trustDevice: action.trustDevice };
		case "SET_TURNSTILE_TOKEN":
			return { ...state, turnstileToken: action.token };
		case "RESET_LOADING":
			return { ...state, isLoading: false };
		default:
			return state;
	}
}
