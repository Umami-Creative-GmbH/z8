/** The codes every kiosk credential refusal family shares. */
type SharedKioskCode = "sign_in_required" | "not_allowed" | "employee_not_found" | "failed";

const APP_ERROR_CODES: Record<string, SharedKioskCode> = {
	AuthenticationError: "sign_in_required",
	AuthorizationError: "not_allowed",
	NotFoundError: "employee_not_found",
};

/**
 * The kiosk code a failed kiosk action stands for, for suites that compare
 * codes: the store's `refusal`, the module's sign-in, access and not-found
 * failures mapped onto the kiosk codes, else `failed`. Clients word failures
 * with `actionErrorMessage` and the kiosk override maps instead.
 */
export function kioskRefusalCode<Code extends string>(result: {
	code?: string;
	refusal?: string;
}): Code | SharedKioskCode {
	if (result.refusal) return result.refusal as Code;
	const code = result.code ?? "failed";
	if (code in APP_ERROR_CODES) return APP_ERROR_CODES[code];
	return /Error$/.test(code) || code === "UNKNOWN_ERROR" ? "failed" : (code as Code);
}
