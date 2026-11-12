import { describe, expect, it } from "vitest";
import { assignedLocationErrorCodeOf } from "./errors";

describe("assignedLocationErrorCodeOf", () => {
	it.each([
		[{ code: "ValidationError", refusal: "former_employee" }, "former_employee"],
		[{ code: "ValidationError", refusal: "location_not_found" }, "location_not_found"],
		[{ code: "AuthorizationError" }, "admin_only"],
		[{ code: "ValidationError" }, "invalid_selection"],
		[{ code: "ValidationError", refusal: "deputy_conflict" }, "invalid_selection"],
		[{ code: "DatabaseError" }, "failed"],
		[{}, "failed"],
	])("maps %o to %s", (failure, code) => {
		expect(assignedLocationErrorCodeOf(failure)).toBe(code);
	});
});
