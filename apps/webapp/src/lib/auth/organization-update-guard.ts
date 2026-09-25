import { APIError } from "better-auth/api";

/**
 * Better Auth's organization update cannot join the configuration protection
 * that manual preparation relies on, so a timezone change through it is refused
 * (#311). The organization settings writer is the only timezone path.
 */
export function rejectProtectedOrganizationUpdate(data: Record<string, unknown>) {
	if ("timezone" in data && data.timezone !== undefined) {
		throw new APIError("BAD_REQUEST", {
			code: "ORGANIZATION_TIMEZONE_PROTECTED",
			message: "Change the organization timezone in the organization settings",
		});
	}
}
