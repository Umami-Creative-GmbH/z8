import { describe, expect, expectTypeOf, it } from "vitest";
import type {
	EmployeeInvitationDraftWithRelations,
	EmployeeMembershipSummary,
	EmployeeWithRelations,
} from "./employee-action-types";
import {
	decodeEmployeeInvitationDraftId,
	normalizeEmployeeDirectoryStatus,
	normalizeEmployeeSelectStatus,
} from "./employee-action-types";

describe("employee list statuses (#1438)", () => {
	it.each([
		["current", "current"],
		["former", "former"],
		["draft", "draft"],
		["all", "all"],
		["active", "current"],
		["inactive", "former"],
	] as const)("reads directory status %s as %s", (status, expected) => {
		expect(normalizeEmployeeDirectoryStatus(status, "all")).toBe(expected);
	});

	it("falls back for a missing or unknown directory status", () => {
		expect(normalizeEmployeeDirectoryStatus(undefined, "all")).toBe("all");
		expect(normalizeEmployeeDirectoryStatus("everyone", "current")).toBe("current");
	});

	it("gives pickers the current roster unless they ask for former employees", () => {
		expect(normalizeEmployeeSelectStatus(undefined)).toBe("current");
		expect(normalizeEmployeeSelectStatus("draft")).toBe("current");
		expect(normalizeEmployeeSelectStatus("active")).toBe("current");
		expect(normalizeEmployeeSelectStatus("bogus")).toBe("current");
		expect(normalizeEmployeeSelectStatus("inactive")).toBe("former");
		expect(normalizeEmployeeSelectStatus("all")).toBe("all");
	});
});

describe("employee invitation draft ids", () => {
	it("decodes URL-encoded draft route params", () => {
		expect(
			decodeEmployeeInvitationDraftId(
				"draft%3A6fb48acc-c71e-4aa7-84e6-4c4351e6a5ed",
			),
		).toBe("6fb48acc-c71e-4aa7-84e6-4c4351e6a5ed");
	});
});

describe("employee membership relation types", () => {
	it("exposes only lifecycle membership fields on real employees", () => {
		expectTypeOf<
			EmployeeWithRelations["membership"]
		>().toEqualTypeOf<EmployeeMembershipSummary | null>();
		expectTypeOf<EmployeeMembershipSummary>().toEqualTypeOf<{
			id: string;
			role: string;
			status: string | null;
		}>();
	});

	it("requires invitation drafts to have no membership", () => {
		expectTypeOf<
			EmployeeInvitationDraftWithRelations["membership"]
		>().toEqualTypeOf<null>();
	});
});
