import { describe, expect, it } from "vitest";
import { invitationSchema } from "./invitation";

describe("invitationSchema", () => {
	it("accepts an ordinary address", () => {
		expect(invitationSchema.safeParse({ email: "alex@example.com", role: "member" }).success).toBe(
			true,
		);
	});

	it("refuses to invite a reserved kiosk-only address (#857)", () => {
		const result = invitationSchema.safeParse({
			email: "kiosk-0123@kiosk.invalid",
			role: "member",
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]).toMatchObject({
			path: ["email"],
			message: "This address cannot receive invitations",
		});
	});
});
