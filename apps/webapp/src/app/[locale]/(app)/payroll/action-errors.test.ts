import { describe, expect, it } from "vitest";
import {
	AuthenticationError,
	AuthorizationError,
	DatabaseError,
	ValidationError,
} from "@/lib/effect/errors";
import { CanonicalCutoverNotReadyError } from "@/lib/time-record/migration/cutover-state";
import { mapPayrollWorkspaceActionError } from "./action-errors";

const t = (_key: string, fallback: string) => fallback;

describe("mapPayrollWorkspaceActionError", () => {
	it("classifies incomplete canonical payroll data as a conflict", () => {
		const reconciliation = {
			workCountMismatch: 0,
			absenceCountMismatch: 0,
			durationMismatchRecords: 0,
			missingWorkCanonicalRecords: 0,
			missingAbsenceCanonicalRecords: 0,
			missingWorkDetailRows: 0,
			missingAbsenceDetailRows: 0,
			missingProjectAllocationRows: 0,
			approvalStateMismatchRecords: 0,
			missingAbsenceCanonicalLinks: 0,
			missingAbsenceOrganizationIds: 0,
		};
		const result = mapPayrollWorkspaceActionError(
			new CanonicalCutoverNotReadyError("org-1", reconciliation),
			t,
		);

		expect(result).toMatchObject({
			_tag: "ConflictError",
			conflictType: "canonical_payroll_data_not_ready",
			message: "Payroll data is temporarily unavailable",
			details: { organizationId: "org-1", reconciliation },
		});
		expect(result.details).toEqual({ organizationId: "org-1", reconciliation });
		expect(result._tag).not.toBe("ValidationError");
	});

	it("preserves authentication, authorization, and validation failures", () => {
		const authentication = new AuthenticationError({ message: "Sign in" });
		const authorization = new AuthorizationError({ message: "Denied" });
		const validation = new ValidationError({ message: "Bad request" });

		expect(mapPayrollWorkspaceActionError(authentication, t)).toBe(
			authentication,
		);
		expect(mapPayrollWorkspaceActionError(authorization, t)).toBe(
			authorization,
		);
		expect(mapPayrollWorkspaceActionError(validation, t)).toBe(validation);
	});

	it("keeps unexpected causes in a server-side database error", () => {
		const cause = new Error("query failed");
		const result = mapPayrollWorkspaceActionError(cause, t);

		expect(result).toBeInstanceOf(DatabaseError);
		expect(result).toMatchObject({
			_tag: "DatabaseError",
			message: "Payroll workspace action failed",
			operation: "payroll_workspace_action",
			cause,
		});
	});
});
