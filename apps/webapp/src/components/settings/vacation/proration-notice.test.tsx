// @vitest-environment jsdom

import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";
import { ProrationNotice } from "./proration-notice";

vi.mock(
	"@/app/[locale]/(app)/settings/vacation/proration-notice-actions",
	() => ({
		dismissProrationNoticeAction: vi.fn(),
	}),
);
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

describe("ProrationNotice policy configuration", () => {
	it.each(["missing", "conflict"] as const)(
		"shows %s policy configuration without invented days",
		(status) => {
			render(
				<ProrationNotice
					rows={[
						{
							employeeId: "employee-1",
							name: "Ada",
							configuration: {
								status,
								periods: [{ startDate: "2026-01-01", endDate: "2026-12-31" }],
							},
							fullAllowance: null,
							proratedAllowance: null,
							overdrawnDays: null,
							allowance: null,
						},
					]}
				/>,
			);
			expect(
				screen.getByText(
					status === "missing"
						? "Missing vacation policy"
						: "Conflicting vacation policies",
				),
			).toBeTruthy();
			const row = screen.getAllByRole("row")[1];
			const cells = within(row).getAllByRole("cell");
			expect(cells.slice(1).map((cell) => cell.textContent)).toEqual([
				"—",
				"—",
				"—",
			]);
		},
	);
});
