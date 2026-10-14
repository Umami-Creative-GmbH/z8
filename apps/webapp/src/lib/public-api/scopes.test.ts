import { describe, expect, it } from "vitest";
import { API_KEY_SCOPES, permissionsOfScopes, scopesOfPermissions } from "./scopes";

describe("key scopes", () => {
	it("offers exactly the seven v1 scopes", () => {
		expect(API_KEY_SCOPES).toEqual([
			"time-entries:read",
			"absences:read",
			"absences:read-health",
			"employees:read",
			"projects:read",
			"customers:read",
			"custom-fields:read-restricted",
		]);
	});

	it("stores scopes as key permissions and reads them back", () => {
		const permissions = permissionsOfScopes([
			"absences:read-health",
			"employees:read",
			"absences:read",
		]);
		expect(permissions).toEqual({
			absences: ["read", "read-health"],
			employees: ["read"],
		});
		expect(scopesOfPermissions(permissions)).toEqual([
			"absences:read",
			"absences:read-health",
			"employees:read",
		]);
	});

	it("stores the restricted custom field scope as its own resource", () => {
		const permissions = permissionsOfScopes(["employees:read", "custom-fields:read-restricted"]);
		expect(permissions).toEqual({
			employees: ["read"],
			"custom-fields": ["read-restricted"],
		});
		expect(scopesOfPermissions(permissions)).toEqual([
			"employees:read",
			"custom-fields:read-restricted",
		]);
	});

	it("drops scopes that v1 does not offer", () => {
		expect(permissionsOfScopes(["time-entries:write", "reports:read", "projects:read"])).toEqual({
			projects: ["read"],
		});
		expect(
			scopesOfPermissions({
				"time-entries": ["read", "write"],
				reports: ["read"],
				projects: ["write"],
			}),
		).toEqual(["time-entries:read"]);
	});

	it("grants nothing for missing or malformed permissions", () => {
		expect(scopesOfPermissions(null)).toEqual([]);
		expect(scopesOfPermissions("employees:read")).toEqual([]);
		expect(scopesOfPermissions({ employees: "read" })).toEqual([]);
	});
});
