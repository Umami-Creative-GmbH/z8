// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PositionCaptureAdminData } from "@/app/[locale]/(app)/settings/position-capture/actions";
import { PositionCaptureSettings } from "./position-capture-settings";

const {
	saveMock,
	setAssignmentMock,
	removeAssignmentMock,
	refreshMock,
	toastMock,
} = vi.hoisted(() => ({
	saveMock: vi.fn(),
	setAssignmentMock: vi.fn(),
	removeAssignmentMock: vi.fn(),
	refreshMock: vi.fn(),
	toastMock: { success: vi.fn(), error: vi.fn() },
}));

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
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/employee-select", () => ({
	EmployeeSingleSelect: ({
		value,
		onChange,
		label,
		disabled,
		employees,
	}: {
		value: string | null;
		onChange: (id: string | null) => void;
		label: string;
		disabled: boolean;
		employees: { id: string; user: { name: string | null } }[];
	}) => (
		<select
			aria-label={label}
			value={value ?? ""}
			disabled={disabled}
			onChange={(event) => onChange(event.target.value)}
		>
			<option value="">Select an employee</option>
			{employees.map((employee) => (
				<option key={employee.id} value={employee.id}>
					{employee.user.name}
				</option>
			))}
		</select>
	),
}));

const teamId = "d8250000-0000-4000-8000-0000000000a1";
const employeeId = "d8250000-0000-4000-8000-000000000004";

function adminData(
	overrides: Partial<PositionCaptureAdminData> = {},
): PositionCaptureAdminData {
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
		saveMock.mockReset().mockResolvedValue({
			success: true,
			data: { publishedNoticeVersion: 1 },
		});
		setAssignmentMock
			.mockReset()
			.mockResolvedValue({ success: true, data: { assignmentId: "a" } });
		removeAssignmentMock.mockReset();
		refreshMock.mockReset();
		toastMock.success.mockReset();
		toastMock.error.mockReset();
	});

	it("does not switch capture on without a purpose statement", async () => {
		render(<PositionCaptureSettings data={adminData()} />);

		await userEvent.click(
			screen.getByRole("switch", { name: "Capture positions" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Save settings" }),
		);

		expect(
			screen.getByText(
				"Write a purpose statement before switching capture on.",
			),
		).toBeTruthy();
		expect(saveMock).not.toHaveBeenCalled();
	});

	it("saves the settings and reports a newly published notice version", async () => {
		render(<PositionCaptureSettings data={adminData()} />);

		await userEvent.click(
			screen.getByRole("switch", { name: "Capture positions" }),
		);
		await userEvent.type(
			screen.getByLabelText("Purpose statement"),
			"Proof of on-site work",
		);
		const retention = screen.getByLabelText("Retention (days)");
		await userEvent.clear(retention);
		await userEvent.type(retention, "30");
		await userEvent.click(
			screen.getByRole("button", { name: "Save settings" }),
		);

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
					settings: {
						enabled: true,
						purposeStatement: "Customer proof",
						retentionDays: 90,
					},
				})}
			/>,
		);

		await userEvent.click(
			screen.getByRole("button", { name: "Save settings" }),
		);

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
					settings: {
						enabled: true,
						purposeStatement: "Customer proof",
						retentionDays: 90,
					},
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
		await userEvent.type(
			screen.getByLabelText("Purpose statement"),
			" and site safety",
		);

		expect(
			screen.getByText(
				"Saving publishes notice version 2. Every existing consent lapses until employees agree again.",
			),
		).toBeTruthy();
	});

	it.each(["organization", "team", "employee"] as const)(
		"assigns capture to a %s and lists it",
		async (scope) => {
			const { rerender } = render(
				<PositionCaptureSettings data={adminData()} />,
			);

			await userEvent.click(screen.getByRole("tab", { name: "Assignments" }));
			expect(screen.getByText("No organization default set")).toBeTruthy();
			expect(screen.getByText("No team-specific settings")).toBeTruthy();
			expect(screen.getByText("No employee-specific settings")).toBeTruthy();
			await userEvent.click(
				screen.getByRole("button", {
					name:
						scope === "organization"
							? "Set Organization Default"
							: scope === "team"
								? "Add Team"
								: "Add Employee",
				}),
			);
			if (scope === "team") {
				await userEvent.click(screen.getByRole("combobox", { name: "Team" }));
				await userEvent.click(
					await screen.findByRole("option", { name: "Field" }),
				);
			} else if (scope === "employee") {
				await userEvent.selectOptions(
					screen.getByRole("combobox", { name: "Employee" }),
					employeeId,
				);
			}
			await userEvent.click(screen.getByRole("button", { name: "Save" }));
			await waitFor(() => expect(refreshMock).toHaveBeenCalled());
			expect(setAssignmentMock).toHaveBeenCalledWith({
				target:
					scope === "organization"
						? { type: "organization" }
						: scope === "team"
							? { type: "team", teamId }
							: { type: "employee", employeeId },
				captureEnabled: true,
			});

			rerender(
				<PositionCaptureSettings
					data={adminData({
						assignments: [
							{
								id: "a1",
								assignmentType: scope,
								teamId: scope === "team" ? teamId : null,
								employeeId: scope === "employee" ? employeeId : null,
								captureEnabled: true,
							},
						],
					})}
				/>,
			);
			const list = await screen.findByRole("list", {
				name:
					scope === "organization"
						? "Organization Default"
						: scope === "team"
							? "Team Overrides"
							: "Employee Overrides",
			});
			expect(
				within(list).getByText(
					scope === "organization"
						? "Whole organization"
						: scope === "team"
							? "Field"
							: "Fiona Field",
				),
			).toBeTruthy();
			expect(
				within(list).getByRole("combobox").textContent?.includes("Capture on"),
			).toBeTruthy();
		},
	);
});
