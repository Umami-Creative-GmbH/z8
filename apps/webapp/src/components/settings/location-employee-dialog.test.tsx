/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { LocationEmployeeDialog } from "./location-employee-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({
		data: [
			{
				id: "emp-1",
				firstName: "Avery",
				lastName: "Employee",
				user: { name: "Avery Employee", email: "avery@example.com" },
			},
		],
		isLoading: false,
	}),
}));

vi.mock("@/app/[locale]/(app)/settings/locations/actions", () => ({
	getAvailableEmployees: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/locations/assignment-actions", () => ({
	assignLocationEmployee: vi.fn(),
}));

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
		open ? <div>{children}</div> : null,
	ActionPanelBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	ActionPanelTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("@/components/ui/checkbox", () => ({
	Checkbox: ({
		checked,
		onCheckedChange,
		id,
	}: {
		checked?: boolean;
		onCheckedChange?: (value: boolean) => void;
		id?: string;
	}) => (
		<input
			type="checkbox"
			id={id}
			checked={checked}
			onChange={(event) => onCheckedChange?.(event.target.checked)}
		/>
	),
}));

vi.mock("@/components/ui/label", () => ({
	Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
		<label {...props}>{children}</label>
	),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: React.ReactNode }) => (
		<button type="button">{children}</button>
	),
	SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

vi.mock("@/components/ui/skeleton", () => ({
	Skeleton: () => <div>loading</div>,
}));

describe("LocationEmployeeDialog", () => {
	it("resets primary supervisor when reopened by a controlled parent", async () => {
		const user = userEvent.setup();

		function Harness() {
			const [open, setOpen] = useState(false);
			return (
				<>
					<button type="button" onClick={() => setOpen(true)}>
						Open
					</button>
					<LocationEmployeeDialog
						organizationId="org-1"
						locationId="loc-1"
						open={open}
						onOpenChange={setOpen}
						onSuccess={vi.fn()}
					/>
				</>
			);
		}

		render(<Harness />);

		await user.click(screen.getByRole("button", { name: "Open" }));
		await user.click(screen.getByLabelText("Primary Supervisor"));
		expect((screen.getByLabelText("Primary Supervisor") as HTMLInputElement).checked).toBe(true);

		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await user.click(screen.getByRole("button", { name: "Open" }));

		expect((screen.getByLabelText("Primary Supervisor") as HTMLInputElement).checked).toBe(false);
	});
});
