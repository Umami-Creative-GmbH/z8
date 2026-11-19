/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, values?: Record<string, string>) => {
			let output = fallback ?? _key;
			for (const [key, value] of Object.entries(values ?? {})) {
				output = output.replace(`{${key}}`, value);
			}
			return output;
		},
	}),
}));

// The page module pulls in server actions and app providers; the alert needs none of them.
vi.mock("@/app/[locale]/(app)/approvals/actions", () => ({}));
vi.mock("../../actions", () => ({}));
vi.mock("../../assignment-actions", () => ({}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/absences/historical-vacation-usage-card", () => ({}));
vi.mock("@/components/providers/view-refresh-provider", () => ({ useViewRefresh: vi.fn() }));

const { PartialSaveAlert } = await import("./employee-allowance-edit-page-client");

describe("PartialSaveAlert", () => {
	it("lists the saved, failed and not-yet-saved parts and retries", () => {
		const onRetry = vi.fn();
		render(
			<PartialSaveAlert
				failure={{
					status: "failed",
					saved: ["policy"],
					failed: { step: "allowance", error: "Allowance is locked" },
					pending: ["adjustment"],
				}}
				isRetrying={false}
				onRetry={onRetry}
			/>,
		);

		const alert = screen.getByRole("alert");
		expect(within(alert).getByText("Some changes were not saved")).toBeTruthy();
		expect(within(alert).getByText("Policy assignment saved.")).toBeTruthy();
		expect(
			within(alert).getByText("Custom allowance could not be saved: Allowance is locked"),
		).toBeTruthy();
		expect(within(alert).getByText("Manual adjustment not saved yet.")).toBeTruthy();

		fireEvent.click(within(alert).getByRole("button", { name: "Retry unsaved changes" }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("falls back to the step's failure message and blocks a second retry while saving", () => {
		render(
			<PartialSaveAlert
				failure={{
					status: "failed",
					saved: [],
					failed: { step: "policy" },
					pending: [],
				}}
				isRetrying
				onRetry={vi.fn()}
			/>,
		);

		expect(screen.getByText("Changes were not saved")).toBeTruthy();
		expect(
			screen.getByText(
				"Policy assignment could not be saved: Failed to update policy assignment",
			),
		).toBeTruthy();
		expect(
			(screen.getByRole("button", { name: "Retry unsaved changes" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});
});
