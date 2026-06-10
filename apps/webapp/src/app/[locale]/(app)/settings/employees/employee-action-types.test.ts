import { describe, expect, it } from "vitest";
import { decodeEmployeeInvitationDraftId } from "./employee-action-types";

describe("employee invitation draft ids", () => {
	it("decodes URL-encoded draft route params", () => {
		expect(decodeEmployeeInvitationDraftId("draft%3A6fb48acc-c71e-4aa7-84e6-4c4351e6a5ed")).toBe(
			"6fb48acc-c71e-4aa7-84e6-4c4351e6a5ed",
		);
	});
});
