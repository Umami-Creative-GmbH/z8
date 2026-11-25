// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
			fallback.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? key)),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("@/lib/organization/driving-licence/check-actions", () => ({
	completeDrivingLicenceCheckAction: vi.fn(),
}));
const { OriginalDrivingCheckForm } = await import("./original-check-form");
afterEach(cleanup);

it("preselects the classes and dates the employee declared, marked as declared (#2003)", () => {
	render(
		<OriginalDrivingCheckForm
			employeeId="employee"
			name="Anna Driver"
			declared={{
				classes: [{ code: "C", expiryDate: "2029-03-31" }],
				documentExpiresOn: "2033-06-30",
				updatedAt: "2026-11-20T10:00:00.000Z",
			}}
			declaredUnchecked={["C"]}
			onCompleted={async () => {}}
		/>,
	);
	expect(screen.getByText("Anna Driver declared C (Truck)")).toBeTruthy();
	expect(screen.getByRole("checkbox", { name: "C Truck" }).getAttribute("aria-checked")).toBe(
		"true",
	);
	expect(screen.getByRole("checkbox", { name: "B Car" }).getAttribute("aria-checked")).toBe(
		"false",
	);
	expect(screen.getAllByText("Declared")).toHaveLength(1);
	expect((screen.getByLabelText("Document expiry date") as HTMLInputElement).value).toBe(
		"2033-06-30",
	);
	expect((screen.getByLabelText("Class expiry (if applicable)") as HTMLInputElement).value).toBe(
		"2029-03-31",
	);
	// The verifier still enters what only the original shows.
	expect((screen.getByLabelText("Document issue date") as HTMLInputElement).value).toBe("");
});

it("starts empty when nothing is declared", () => {
	render(
		<OriginalDrivingCheckForm
			employeeId="employee"
			name="Anna Driver"
			onCompleted={async () => {}}
		/>,
	);
	expect(screen.queryByText(/declared/i)).toBeNull();
	expect(screen.getByRole("checkbox", { name: "C Truck" }).getAttribute("aria-checked")).toBe(
		"false",
	);
});
