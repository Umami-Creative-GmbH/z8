/* @vitest-environment jsdom */
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalTriageSettingsForm } from "./triage-settings-form";

const transport = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock(
	"@/app/[locale]/(app)/settings/approval-policies/triage-actions",
	() => ({ saveApprovalTriageSettingsAction: transport.save }),
);
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
describe("approval triage settings form", () => {
	it("saves admin threshold edits including zero and shows the saved values", async () => {
		transport.save.mockResolvedValue({
			success: true,
			data: { staleAfterHours: 24, smallCorrectionMinutes: 0 },
		});
		render(
			<ApprovalTriageSettingsForm
				policy={{ staleAfterHours: 72, smallCorrectionMinutes: 15 }}
			/>,
		);
		fireEvent.change(screen.getByLabelText("Stale after (hours)"), {
			target: { value: "24" },
		});
		fireEvent.change(
			screen.getByLabelText("Small correction limit (minutes)"),
			{ target: { value: "0" } },
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Save triage settings" }),
		);
		await screen.findByRole("status");
		expect(screen.getByRole("status").textContent).toContain(
			"Triage settings saved",
		);
		expect(transport.save).toHaveBeenCalledWith({
			staleAfterHours: 24,
			smallCorrectionMinutes: 0,
		});
		expect(
			(
				screen.getByLabelText(
					"Small correction limit (minutes)",
				) as HTMLInputElement
			).value,
		).toBe("0");
		expect(
			screen.getByText(/Zero disables the small-correction fast lane/),
		).toBeTruthy();
	});
});

it("keeps invalid values visible with accessible feedback and does not submit them", async () => {
	render(
		<ApprovalTriageSettingsForm
			policy={{ staleAfterHours: 72, smallCorrectionMinutes: 15 }}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Stale after (hours)"), {
		target: { value: "1.5" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save triage settings" }));
	expect(
		await screen.findByText("Enter a whole number from 1 to 720 hours."),
	).toBeTruthy();
	await waitFor(() => expect(transport.save).not.toHaveBeenCalled());
	expect(document.activeElement).toBe(
		screen.getByLabelText("Stale after (hours)"),
	);
	expect(
		screen.getByLabelText("Stale after (hours)").getAttribute("aria-invalid"),
	).toBe("true");
});
it("shows server refusal inline while preserving the administrator's edits", async () => {
	transport.save.mockResolvedValue({
		success: false,
		error: "Only organization admins can change approval triage settings.",
	});
	render(
		<ApprovalTriageSettingsForm
			policy={{ staleAfterHours: 72, smallCorrectionMinutes: 15 }}
		/>,
	);
	fireEvent.change(screen.getByLabelText("Stale after (hours)"), {
		target: { value: "24" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save triage settings" }));
	expect((await screen.findByRole("alert")).textContent).toContain(
		"Only organization admins",
	);
	expect(
		(screen.getByLabelText("Stale after (hours)") as HTMLInputElement).value,
	).toBe("24");
});
it("shows a retryable error when the save transport fails", async () => {
	transport.save.mockRejectedValue(new Error("Network disconnected"));
	render(
		<ApprovalTriageSettingsForm
			policy={{ staleAfterHours: 72, smallCorrectionMinutes: 15 }}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Save triage settings" }));
	expect((await screen.findByRole("alert")).textContent).toContain(
		"Unable to save triage settings. Please try again.",
	);
});
