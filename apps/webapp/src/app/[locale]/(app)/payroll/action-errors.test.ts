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
		const result = mapPayrollWorkspaceActionError(
			new CanonicalCutoverNotReadyError("org-1"),
			t,
		);

		expect(result).toMatchObject({
			_tag: "ConflictError",
			conflictType: "canonical_payroll_data_not_ready",
			message: "Payroll data is temporarily unavailable",
		});
		expect(result._tag).not.toBe("ValidationError");
	});

	it("preserves authentication, authorization, and validation failures", () => {
		const authentication = new AuthenticationError({ message: "Sign in" });
		const authorization = new AuthorizationError({ message: "Denied" });
		const validation = new ValidationError({ message: "Bad request" });

		expect(mapPayrollWorkspaceActionError(authentication, t)).toBe(authentication);
		expect(mapPayrollWorkspaceActionError(authorization, t)).toBe(authorization);
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
