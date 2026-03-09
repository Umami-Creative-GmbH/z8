import { describe, expect, it } from "vitest";
import { reconcileCanonicalParity } from "@/lib/time-record/migration/reconciliation";

describe("canonical reconciliation parity", () => {
	it("reports zero mismatch metrics when legacy and canonical totals match", () => {
		const result = reconcileCanonicalParity({
			organizationId: "org-1",
			legacy: {
				workCount: 3,
				absenceCount: 2,
				durationMinutes: 510,
			},
			canonical: {
				workCount: 3,
				absenceCount: 2,
				durationMinutes: 510,
			},
		});

		expect(result).toEqual({
			organizationId: "org-1",
			workCountMismatch: 0,
			absenceCountMismatch: 0,
			durationMismatchMinutes: 0,
			hasMismatch: false,
		});
	});

	it("reports mismatch metrics when canonical totals diverge", () => {
		const result = reconcileCanonicalParity({
			organizationId: "org-1",
			legacy: {
				workCount: 4,
				absenceCount: 1,
				durationMinutes: 480,
			},
			canonical: {
				workCount: 5,
				absenceCount: 3,
				durationMinutes: 525,
			},
		});

		expect(result).toEqual({
			organizationId: "org-1",
			workCountMismatch: 1,
			absenceCountMismatch: 2,
			durationMismatchMinutes: 45,
			hasMismatch: true,
		});
	});

	it("throws when organization scope does not match", () => {
		expect(() =>
			reconcileCanonicalParity({
				organizationId: "org-1",
				legacy: {
					organizationId: "org-1",
					workCount: 1,
					absenceCount: 1,
					durationMinutes: 60,
				},
				canonical: {
					organizationId: "org-2",
					workCount: 1,
					absenceCount: 1,
					durationMinutes: 60,
				},
			}),
		).toThrowError(/Organization scope mismatch for canonical reconciliation/);
	});
});
