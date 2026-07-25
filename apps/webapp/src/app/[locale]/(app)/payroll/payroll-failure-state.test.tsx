// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PayrollFailureState } from "./payroll-failure-state";

const t = (_key: string, fallback: string) => fallback;

describe("PayrollFailureState", () => {
	it.each(["AuthenticationError", "AuthorizationError"])(
		"renders access denied for %s",
		(code) => {
			render(<PayrollFailureState code={code} t={t} />);

			expect(screen.getByText("No payroll access")).toBeTruthy();
			expect(screen.queryByText("Payroll temporarily unavailable")).toBeNull();
		},
	);

	it.each(["ConflictError", "DatabaseError", "UNKNOWN_ERROR", undefined])(
		"renders temporary unavailability for operational code %s",
		(code) => {
			render(<PayrollFailureState code={code} t={t} />);

			expect(screen.getByText("Payroll temporarily unavailable")).toBeTruthy();
			expect(screen.queryByText("No payroll access")).toBeNull();
		},
	);
});
