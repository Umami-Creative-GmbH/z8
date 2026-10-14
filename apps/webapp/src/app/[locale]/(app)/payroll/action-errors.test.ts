import { describe, expect, it } from "vitest";
import {
	AuthenticationError,
	AuthorizationError,
	DatabaseError,
	ValidationError,
} from "@/lib/effect/errors";
import { PayrollIdentifierDuplicateError } from "@/lib/payroll-export/personnel-identifier";
import { PayrollWorkAllocationBlockedError } from "@/lib/payroll-export/work-allocation-blocked-error";
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

	it("reports blocked work allocation as a conflict without employee details", () => {
		const result = mapPayrollWorkspaceActionError(
			new PayrollWorkAllocationBlockedError("org-1", [
				{ recordId: "record-1", employeeId: "employee-1", reason: "unresolved_interval" },
			]),
			t,
		);

		expect(result).toMatchObject({
			_tag: "ConflictError",
			conflictType: "payroll_work_minutes_unresolved",
			message: "Export blocked: resolve the work minutes that need review first",
		});
		expect(result.details).toEqual({ organizationId: "org-1", blockedRecordCount: 1 });
	});

	it("names the employees sharing a personnel identifier in a translated conflict", () => {
		const translate = (key: string, fallback: string, params?: Record<string, string>) =>
			`${key}|${fallback.replace("{employees}", params?.employees ?? "")}`;
		const result = mapPayrollWorkspaceActionError(
			new PayrollIdentifierDuplicateError(
				[
					{
						employees: [
							{ employeeId: "employee-1", identifier: "E-42", name: "Anna Muster" },
							{ employeeId: "employee-2", identifier: "e-42", name: null },
						],
					},
				],
				"org-1",
			),
			translate,
		);

		expect(result).toMatchObject({
			_tag: "ConflictError",
			conflictType: "payroll_identifier_duplicate",
			message:
				"payroll.errors.exportBlockedByDuplicateIdentifier|Export blocked: several employees share a personnel identifier. Give each employee their own: Anna Muster (E-42), employee-2 (e-42)",
		});
		expect(result.details).toEqual({
			organizationId: "org-1",
			clashes: [
				[
					{ employeeId: "employee-1", identifier: "E-42" },
					{ employeeId: "employee-2", identifier: "e-42" },
				],
			],
		});
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
