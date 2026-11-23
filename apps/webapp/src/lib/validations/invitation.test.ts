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

	describe("External Contractor invitations (#1995)", () => {
		const PROJECT = "6f1c1e9e-8a5c-4e0e-9a51-0c6f1f7c2b11";

		it("invites an employee unless told otherwise", () => {
			const result = invitationSchema.parse({ email: "alex@example.com", role: "member" });
			expect(result.engagementKind).toBe("employee");
		});

		it("accepts a contractor with optional contracting details, projects and a planned end", () => {
			const result = invitationSchema.parse({
				email: "grace@hopper.example",
				role: "member",
				engagementKind: "contractor",
				contractor: {
					companyName: "  Hopper Consulting GmbH ",
					vatId: "DE123456789",
					referenceCode: "",
					projectIds: [PROJECT],
					plannedEndDate: "2027-06-30",
				},
			});
			expect(result).toMatchObject({
				engagementKind: "contractor",
				contractor: {
					companyName: "Hopper Consulting GmbH",
					vatId: "DE123456789",
					referenceCode: null,
					projectIds: [PROJECT],
					plannedEndDate: "2027-06-30",
				},
			});
		});

		it("refuses contractor details on an employee invitation", () => {
			const result = invitationSchema.safeParse({
				email: "alex@example.com",
				role: "member",
				engagementKind: "employee",
				contractor: { companyName: "Acme" },
			});
			expect(result.success).toBe(false);
			expect(result.error?.issues[0]?.path).toEqual(["contractor"]);
		});

		it("refuses an over-long VAT ID and an invalid planned end date", () => {
			const result = invitationSchema.safeParse({
				email: "grace@hopper.example",
				role: "member",
				engagementKind: "contractor",
				contractor: { vatId: "X".repeat(51), plannedEndDate: "30.06.2027" },
			});
			expect(result.success).toBe(false);
			expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
				"contractor.vatId",
				"contractor.plannedEndDate",
			]);
		});
	});
});
