/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
	chooseTeams: vi.fn(),
	exclude: vi.fn(),
	lift: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("./go-live-group-actions", () => ({
	chooseGoLiveGroupTeamsAction: actions.chooseTeams,
	createGoLiveExclusionAction: actions.exclude,
	liftGoLiveExclusionAction: actions.lift,
}));

vi.mock("sonner", () => ({ toast: { error: actions.toastError, success: vi.fn() } }));

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({ locale: "en-US", timezone: "UTC", timeFormat: "24h" }),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, string | number>) =>
			Object.entries(values ?? {}).reduce(
				(text, [name, value]) =>
					text
						.replace(
							new RegExp(`\\{${name}, plural, one \\{([^}]*)\\} other \\{([^}]*)\\}\\}`),
							(_match, one: string, other: string) =>
								(value === 1 ? one : other).replaceAll("#", String(value)),
						)
						.replaceAll(`{${name}}`, String(value)),
				fallback,
			),
	}),
}));

vi.mock("@/components/employee-select", () => ({
	EmployeeSingleSelect: ({
		value,
		onChange,
		label,
	}: {
		value: string | null;
		onChange: (value: string | null) => void;
		label?: string;
	}) => (
		<label>
			{label}
			<input value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} />
		</label>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { GoLiveGroupCard } from "./go-live-group-card";

const WAREHOUSE = "6f0f5d1c-9a53-4a8e-9a43-2f6f1c2a9b10";
const OFFICE = "1a2b3c4d-9a53-4a8e-9a43-2f6f1c2a9b10";

const settings = {
	teams: [
		{ id: OFFICE, name: "Office" },
		{ id: WAREHOUSE, name: "Warehouse" },
	],
	chosenTeamIds: [WAREHOUSE],
	exclusions: [
		{
			id: "8e2b7c41-7f0a-4f43-9d0e-1b6c3a5d7e30",
			employeeId: "0d5c9a9e-3c51-4c8f-8f6e-6a3f1c2b4d20",
			displayName: "Dana Director",
			reason: "Doesn't track time",
			createdByName: "Olga Owner",
			createdAt: "2026-06-14T09:00:00Z",
		},
	],
};

describe("GoLiveGroupCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actions.chooseTeams.mockResolvedValue({ success: true });
		actions.exclude.mockResolvedValue({ success: true });
		actions.lift.mockResolvedValue({ success: true });
	});

	it("shows the chosen teams and saves a new choice", async () => {
		render(<GoLiveGroupCard group={settings} memberCount={7} />);

		expect(screen.getByText("7 people are checked")).toBeTruthy();
		expect(screen.getByRole("checkbox", { name: "Warehouse" }).getAttribute("aria-checked")).toBe(
			"true",
		);
		fireEvent.click(screen.getByRole("checkbox", { name: "Office" }));
		fireEvent.click(screen.getByRole("button", { name: "Save teams" }));

		await waitFor(() => expect(actions.chooseTeams).toHaveBeenCalledTimes(1));
		expect([...(actions.chooseTeams.mock.calls[0]?.[0] ?? [])].sort()).toEqual(
			[OFFICE, WAREHOUSE].sort(),
		);
	});

	it("lists exclusions with reason, who and when, and lifts one", async () => {
		render(<GoLiveGroupCard group={settings} memberCount={7} />);

		expect(screen.getByText("Dana Director")).toBeTruthy();
		expect(screen.getByText("Doesn't track time")).toBeTruthy();
		expect(screen.getByText(/Excluded by Olga Owner on Jun 14, 2026/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Lift exclusion for Dana Director" }));

		await waitFor(() =>
			expect(actions.lift).toHaveBeenCalledWith("8e2b7c41-7f0a-4f43-9d0e-1b6c3a5d7e30"),
		);
	});

	it("won't exclude anyone without a reason", async () => {
		render(<GoLiveGroupCard group={{ ...settings, exclusions: [] }} memberCount={7} />);

		expect(screen.getByText("Nobody is excluded.")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Employee"), {
			target: { value: "0d5c9a9e-3c51-4c8f-8f6e-6a3f1c2b4d20" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Exclude" }));

		expect(await screen.findByText("Give a reason for the exclusion.")).toBeTruthy();
		expect(actions.exclude).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Director" } });
		fireEvent.click(screen.getByRole("button", { name: "Exclude" }));

		await waitFor(() =>
			expect(actions.exclude).toHaveBeenCalledWith({
				employeeId: "0d5c9a9e-3c51-4c8f-8f6e-6a3f1c2b4d20",
				reason: "Director",
			}),
		);
	});

	it("says when the group settings couldn't be loaded", () => {
		render(<GoLiveGroupCard group={null} memberCount={null} />);

		expect(
			screen.getByText(
				"The go-live group's teams and exclusions couldn't be loaded. Retry the checks.",
			),
		).toBeTruthy();
	});
});
