import { describe, expect, expectTypeOf, it } from "vitest";
import type {
	EmployeeInvitationDraftWithRelations,
	EmployeeMembershipSummary,
	EmployeeWithRelations,
} from "./employee-action-types";
import { decodeEmployeeInvitationDraftId } from "./employee-action-types";

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
