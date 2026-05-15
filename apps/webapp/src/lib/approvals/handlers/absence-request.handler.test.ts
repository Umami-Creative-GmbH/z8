import { describe, expect, it } from "vitest";
import { redactNonSickAbsenceSickDetail } from "./absence-request.handler";

describe("redactNonSickAbsenceSickDetail", () => {
	it("redacts stale sick detail from non-sick absence entities", () => {
		const absence = redactNonSickAbsenceSickDetail({
			id: "absence-vacation",
			startDate: "2026-06-01",
			startPeriod: "full_day",
			endDate: "2026-06-01",
			endPeriod: "full_day",
			notes: null,
			sickDetail: "with_certificate",
			status: "pending",
			createdAt: new Date("2026-05-01T00:00:00.000Z"),
			employee: {
				id: "employee-1",
				userId: "user-1",
				teamId: null,
				organizationId: "org-1",
				user: {
					id: "user-1",
					name: "Ada Lovelace",
					email: "ada@example.com",
					image: null,
				},
			},
			category: {
				id: "category-vacation",
				name: "Vacation",
				type: "vacation",
				color: null,
			},
		});

		expect(absence.sickDetail).toBeNull();
	});
});
