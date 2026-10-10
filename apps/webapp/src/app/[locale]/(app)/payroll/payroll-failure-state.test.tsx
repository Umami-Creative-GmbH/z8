// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PayrollFailureState } from "./payroll-failure-state";

const t = (_key: string, fallback: string) => fallback;

describe("PayrollFailureState", () => {
	it.each([
		"AuthenticationError",
		"AuthorizationError",
	])("renders access denied for %s", (code) => {
		render(<PayrollFailureState code={code} t={t} />);

		expect(screen.getByText("No payroll access")).toBeTruthy();
		expect(screen.queryByText("Payroll temporarily unavailable")).toBeNull();
	});

	it("offers Work balances when the payroll access covers only employees who have left (#995)", () => {
		render(<PayrollFailureState code="AuthorizationError" t={t} offerWorkBalances />);

		expect(
			screen.getByText("Only employees who have left are in your payroll access"),
		).toBeTruthy();
		expect(screen.queryByText("No payroll access")).toBeNull();
		expect(screen.getByRole("link", { name: "Work balances" }).getAttribute("href")).toBe(
			"/payroll/work-balances",
		);
	});

	it("does not offer Work balances when payroll is unavailable", () => {
		render(<PayrollFailureState code="DatabaseError" t={t} offerWorkBalances />);

		expect(screen.getByText("Payroll temporarily unavailable")).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it.each([
		"ConflictError",
		"DatabaseError",
		"UNKNOWN_ERROR",
		undefined,
	])("renders temporary unavailability for operational code %s", (code) => {
		render(<PayrollFailureState code={code} t={t} />);

		expect(screen.getByText("Payroll temporarily unavailable")).toBeTruthy();
		expect(screen.queryByText("No payroll access")).toBeNull();
	});
});
