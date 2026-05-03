/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const markComplete = vi.fn();
const markIncomplete = vi.fn();
const toastError = vi.fn();

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/progress", () => ({
	Progress: (props: React.HTMLAttributes<HTMLDivElement> & { value?: number }) => (
		<div role="progressbar" aria-valuenow={props.value} {...props} />
	),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastError,
	},
}));

vi.mock("./actions", () => ({
	markImplementationChecklistItemComplete: markComplete,
	markImplementationChecklistItemIncomplete: markIncomplete,
}));

const checklist = {
	completedCount: 1,
	totalCount: 2,
	items: [
		{
			id: "organization-structure",
			title: "Organization structure",
			description: "Confirm members, teams, and responsibility boundaries before rollout.",
			helperText: "Manual review: Z8 cannot know whether your rollout structure is final.",
			actionLabel: "Review organization",
			href: "/settings/organizations",
			detector: "manual",
			canManualComplete: true,
			status: "not-started",
			completionSource: null,
			canToggleManualCompletion: true,
		},
		{
			id: "holidays",
			title: "Holidays",
			description: "Configure public holidays and closing days used by absence and payroll workflows.",
			helperText: "Z8 checks for active holiday presets, assignments, or custom holidays.",
			actionLabel: "Configure holidays",
			href: "/settings/holidays",
			detector: "automatic",
			canManualComplete: false,
			status: "complete",
			completionSource: "automatic",
			canToggleManualCompletion: false,
		},
	],
} as const;

describe("ImplementationChecklistClient", () => {
	beforeEach(() => {
		markComplete.mockReset();
		markIncomplete.mockReset();
		toastError.mockReset();
	});

	it("renders checklist summary, task links, status, and manual completion controls", async () => {
		const { ImplementationChecklistClient } = await import("./implementation-checklist-client");

		render(<ImplementationChecklistClient checklist={checklist} />);

		expect(screen.getByText("Customer implementation")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Implementation checklist", level: 1 })).toBeTruthy();
		expect(screen.getByText(/Finish the setup steps before inviting your full team/i)).toBeTruthy();
		expect(screen.getByText("1 of 2 complete")).toBeTruthy();
		expect(screen.getByText("50% complete")).toBeTruthy();
		expect(screen.getByLabelText("Implementation checklist progress")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Review organization" }).getAttribute("href")).toBe(
			"/settings/organizations",
		);
		expect(screen.getByRole("link", { name: "Configure holidays" }).getAttribute("href")).toBe(
			"/settings/holidays",
		);
		expect(screen.getByRole("button", { name: "Mark complete" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Mark incomplete" })).toBeNull();
	});

	it("marks manual items complete and shows an error toast on failure", async () => {
		markComplete.mockResolvedValue({ success: false, error: "Unable to update checklist" });
		const { ImplementationChecklistClient } = await import("./implementation-checklist-client");

		render(<ImplementationChecklistClient checklist={checklist} />);
		fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));

		await waitFor(() => {
			expect(markComplete).toHaveBeenCalledWith("organization-structure");
			expect(toastError).toHaveBeenCalledWith("Unable to update checklist");
		});
	});
});
