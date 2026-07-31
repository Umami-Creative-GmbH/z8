/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createShiftTemplate: vi.fn(),
	deleteShiftTemplate: vi.fn(),
	getShiftTemplates: vi.fn(),
	updateShiftTemplate: vi.fn(),
}));

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

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({
	createShiftTemplate: mocks.createShiftTemplate,
	deleteShiftTemplate: mocks.deleteShiftTemplate,
	getShiftTemplates: mocks.getShiftTemplates,
	updateShiftTemplate: mocks.updateShiftTemplate,
}));

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: ({ children, open }: { children: ReactNode; open: boolean }) =>
		open ? <div>{children}</div> : null,
	ActionPanelBody: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ActionPanelContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ActionPanelDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	ActionPanelFooter: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ActionPanelHeader: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ActionPanelTitle: ({ children }: { children: ReactNode }) => (
		<h2>{children}</h2>
	),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({
		children,
		value,
		onValueChange,
	}: {
		children: ReactNode;
		value: string;
		onValueChange: (value: string) => void;
	}) => (
		<select
			value={value}
			onChange={(event) => onValueChange(event.target.value)}
		>
			{children}
		</select>
	),
	SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
	SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
		<option value={value}>{children}</option>
	),
	SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
	SelectValue: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/time-input", () => ({
	TimeInput: (props: ComponentProps<"input">) => (
		<input type="time" {...props} />
	),
}));

import { ShiftTemplateManagement } from "./shift-template-management";

function renderManagement() {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<ShiftTemplateManagement
				organizationId="org_123"
				manageableSubareaIds={["subarea_allowed"]}
				locations={[
					{
						id: "location_1",
						name: "Berlin",
						subareas: [
							{ id: "subarea_allowed", name: "Front desk", isActive: true },
							{ id: "subarea_denied", name: "Secure room", isActive: true },
						],
					},
				]}
			/>
		</QueryClientProvider>,
	);
}

describe("ShiftTemplateManagement", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getShiftTemplates.mockResolvedValue({ success: true, data: [] });
		mocks.createShiftTemplate.mockResolvedValue({
			success: true,
			data: { id: "template_1" },
		});
	});

	it("keeps scoped subareas and the complete shift template payload intact", async () => {
		renderManagement();

		await screen.findByText("No templates yet");
		fireEvent.click(screen.getByRole("button", { name: "Add Template" }));

		expect(
			screen.getByRole("option", { name: "Berlin – Front desk" }),
		).toBeTruthy();
		expect(
			screen.queryByRole("option", { name: "Berlin – Secure room" }),
		).toBeNull();

		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "Early shift" },
		});
		fireEvent.change(screen.getByLabelText("Start Time"), {
			target: { value: "06:30" },
		});
		fireEvent.change(screen.getByLabelText("End Time"), {
			target: { value: "14:45" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Purple" }));
		fireEvent.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() => {
			expect(mocks.createShiftTemplate).toHaveBeenCalledWith({
				name: "Early shift",
				startTime: "06:30",
				endTime: "14:45",
				color: "#a855f7",
				subareaId: "subarea_allowed",
			});
		});
	});
});
