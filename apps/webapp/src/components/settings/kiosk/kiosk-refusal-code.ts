/** The codes every kiosk credential refusal family shares. */
type SharedKioskCode = "sign_in_required" | "not_allowed" | "employee_not_found" | "failed";

const APP_ERROR_CODES: Record<string, SharedKioskCode> = {
	AuthenticationError: "sign_in_required",
	AuthorizationError: "not_allowed",
	NotFoundError: "employee_not_found",
};

/**
 * The kiosk refusal code of a failed kiosk action (#1613): the store's code an
 * `organizationAction` returns as `refusal`, the settings-access refusal mapped
 * onto the kiosk codes, or (for actions still on `runRefusalAction`) the code
 * itself. Anything else is `failed`.
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
