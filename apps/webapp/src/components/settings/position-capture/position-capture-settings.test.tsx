// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PositionCaptureAdminData } from "@/app/[locale]/(app)/settings/position-capture/actions";
import { PositionCaptureSettings } from "./position-capture-settings";

const { saveMock, setAssignmentMock, removeAssignmentMock, refreshMock, toastMock } = vi.hoisted(
	() => ({
		saveMock: vi.fn(),
		setAssignmentMock: vi.fn(),
		removeAssignmentMock: vi.fn(),
		refreshMock: vi.fn(),
		toastMock: { success: vi.fn(), error: vi.fn() },
	}),
);

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) => {
			let translated = fallback.replace(
				/\{(\w+), plural, one \{# (\w+)\} other \{# (\w+)\}\}/g,
				(_match, name: string, one: string, other: string) =>
					`${params?.[name]} ${params?.[name] === 1 ? one : other}`,
			);
			for (const [key, value] of Object.entries(params ?? {})) {
				translated = translated.replace(`{${key}}`, String(value));
			}
			return translated;
		},
	}),
}));
vi.mock("@/app/[locale]/(app)/settings/position-capture/actions", () => ({
	savePositionCaptureSettingsAction: saveMock,
	setPositionCaptureAssignmentAction: setAssignmentMock,
	removePositionCaptureAssignmentAction: removeAssignmentMock,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const teamId = "d8250000-0000-4000-8000-0000000000a1";
const employeeId = "d8250000-0000-4000-8000-000000000004";

function adminData(overrides: Partial<PositionCaptureAdminData> = {}): PositionCaptureAdminData {
	return {
		settings: { enabled: false, purposeStatement: null, retentionDays: 90 },
		notices: [],
		assignments: [],
		teams: [{ id: teamId, name: "Field" }],
		employees: [{ id: employeeId, name: "Fiona Field" }],
		...overrides,
	};
}

describe("PositionCaptureSettings", () => {
	beforeEach(() => {
		saveMock.mockReset().mockResolvedValue({ success: true, data: { publishedNoticeVersion: 1 } });
		setAssignmentMock.mockReset().mockResolvedValue({ success: true, data: { assignmentId: "a" } });
		removeAssignmentMock.mockReset();
		refreshMock.mockReset();
		toastMock.success.mockReset();
		toastMock.error.mockReset();
	});

	it("does not switch capture on without a purpose statement", async () => {
		render(<PositionCaptureSettings data={adminData()} />);

		await userEvent.click(screen.getByRole("switch", { name: "Capture positions" }));
		await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

		expect(screen.getByText("Write a purpose statement before switching capture on.")).toBeTruthy();
		expect(saveMock).not.toHaveBeenCalled();
	});

	it("saves the settings and reports a newly published notice version", async () => {
		render(<PositionCaptureSettings data={adminData()} />);

		await userEvent.click(screen.getByRole("switch", { name: "Capture positions" }));
		await userEvent.type(screen.getByLabelText("Purpose statement"), "Proof of on-site work");
		const retention = screen.getByLabelText("Retention (days)");
		await userEvent.clear(retention);
		await userEvent.type(retention, "30");
		await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

		expect(saveMock).toHaveBeenCalledWith({
			enabled: true,
			purposeStatement: "Proof of on-site work",
			retentionDays: 30,
		});
		await waitFor(() =>
			expect(toastMock.success).toHaveBeenCalledWith(
				"Settings saved. Notice version 1 is published; employees are asked to agree to it.",
			),
		);
		expect(refreshMock).toHaveBeenCalled();
	});

	it("translates a refused save by its code and never shows the server's text", async () => {
		saveMock.mockResolvedValue({
			success: false,
			error: "diagnostic text from the server",
			code: "retention_out_of_range",
		});
		render(
			<PositionCaptureSettings
				data={adminData({
					settings: { enabled: true, purposeStatement: "Customer proof", retentionDays: 90 },
				})}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

		await waitFor(() =>
			expect(toastMock.error).toHaveBeenCalledWith(
				"Retention must be a whole number of days between 7 and 365.",
			),
		);
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("warns that editing the purpose publishes a new version and lapses consents", async () => {
		render(
			<PositionCaptureSettings
				data={adminData({
					settings: { enabled: true, purposeStatement: "Customer proof", retentionDays: 90 },
					notices: [
						{
							id: "n1",
							version: 1,
							purposeStatement: "Customer proof",
							retentionDays: 90,
							templateRevision: 1,
							createdAt: "2026-10-01T08:00:00Z",
						},
					],
				})}
			/>,
		);

		expect(screen.queryByText(/publishes notice version 2/)).toBeNull();
		await userEvent.type(screen.getByLabelText("Purpose statement"), " and site safety");

		expect(
			screen.getByText(
				"Saving publishes notice version 2. Every existing consent lapses until employees agree again.",
			),
		).toBeTruthy();
	});

	it("assigns capture to a team and lists the assignment", async () => {
		const { rerender } = render(<PositionCaptureSettings data={adminData()} />);

		expect(
			screen.getByText("Nobody is assigned. Capture applies to nobody until you assign it."),
		).toBeTruthy();
		expect(screen.getByRole("combobox", { name: "Applies to" }).textContent).toContain("A team");
		await userEvent.click(screen.getByRole("combobox", { name: "Team" }));
		await userEvent.click(await screen.findByRole("option", { name: "Field" }));
		await userEvent.click(screen.getByRole("button", { name: "Add assignment" }));

		expect(setAssignmentMock).toHaveBeenCalledWith({
			target: { type: "team", teamId },
			captureEnabled: true,
		});

		rerender(
			<PositionCaptureSettings
				data={adminData({
					assignments: [
						{
							id: "a1",
							assignmentType: "team",
							teamId,
							employeeId: null,
							captureEnabled: true,
						},
					],
				})}
			/>,
		);
		const list = screen.getByRole("list", { name: "Capture assignments" });
		expect(within(list).getByText("Team: Field")).toBeTruthy();
		expect(within(list).getByText("Capture on")).toBeTruthy();
	});
});
