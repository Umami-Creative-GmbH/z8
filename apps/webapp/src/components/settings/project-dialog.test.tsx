/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ProjectTemplate,
	ProjectTemplateSummary,
} from "@/lib/projects/project-template-model";
import { ProjectDialog } from "./project-dialog";

const projectActions = vi.hoisted(() => ({ createProject: vi.fn(), updateProject: vi.fn() }));
const fromTemplateActions = vi.hoisted(() => ({
	getProjectTemplateChoices: vi.fn(),
	getProjectTemplatePreview: vi.fn(),
	createProjectFromTemplate: vi.fn(),
}));
const customerActions = vi.hoisted(() => ({ getCustomersForSelection: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock("@/app/[locale]/(app)/settings/projects/actions", () => projectActions);
vi.mock("@/app/[locale]/(app)/settings/projects/from-template-actions", () => fromTemplateActions);
vi.mock("@/app/[locale]/(app)/settings/customers/actions", () => customerActions);
vi.mock("sonner", () => ({ toast }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));

// Renders defaults with their parameters, including `{count, plural, one {…} other {…}}`.
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			params
				? fallback
						.replace(
							/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g,
							(_match, name: string, one: string, other: string) =>
								(params[name] === 1 ? one : other).replace("#", String(params[name])),
						)
						.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match))
				: fallback,
	}),
}));

// Radix Select needs pointer APIs jsdom lacks; a native select keeps the same contract.
vi.mock("@/components/ui/select", () => {
	const SelectTrigger = (_props: { id?: string; "aria-label"?: string; children?: ReactNode }) =>
		null;
	const SelectValue = (_props: { placeholder?: string }) => null;
	const SelectContent = ({ children }: { children: ReactNode }) => <>{children}</>;
	const SelectItem = ({ value, children }: { value: string; children: ReactNode }) => (
		<option value={value}>{children}</option>
	);
	const Select = ({
		value,
		onValueChange,
		children,
	}: {
		value?: string;
		onValueChange?: (value: string) => void;
		children: ReactNode;
	}) => {
		const parts = Children.toArray(children).filter(isValidElement) as ReactElement<{
			id?: string;
			"aria-label"?: string;
			children?: ReactNode;
		}>[];
		const trigger = parts.find((part) => part.type === SelectTrigger);
		const content = parts.find((part) => part.type === SelectContent);
		return (
			<select
				id={trigger?.props.id}
				aria-label={trigger?.props["aria-label"]}
				value={value}
				onChange={(event) => onValueChange?.(event.target.value)}
			>
				<option value="" />
				{content?.props.children}
			</select>
		);
	};
	return { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
});

const relaunchSummary: ProjectTemplateSummary = {
	id: "template-1",
	name: "Website relaunch",
	description: null,
	icon: "IconRocket",
	color: "#3b82f6",
	budgetHours: "120.00",
	deadlineOffsetDays: 30,
	taskCount: 2,
	managerCount: 1,
	assignmentCount: 2,
	updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const relaunchPreview: ProjectTemplate = {
	id: "template-1",
	organizationId: "org-1",
	name: "Website relaunch",
	description: null,
	icon: "IconRocket",
	color: "#3b82f6",
	budgetHours: "120.00",
	deadlineOffsetDays: 30,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	tasks: [
		{ id: "tt-1", name: "Build", description: null, estimateHours: null },
		{ id: "tt-2", name: "Design", description: null, estimateHours: "12.50" },
	],
	managers: [{ id: "tm-1", employeeId: "emp-left", name: "Lee Left", availability: "departed" }],
	assignments: [
		{
			id: "ta-1",
			type: "team",
			teamId: "team-1",
			employeeId: null,
			name: "Design team",
			availability: "available",
		},
		{
			id: "ta-2",
			type: "team",
			teamId: null,
			employeeId: null,
			name: "Old team",
			availability: "removed",
		},
	],
};

function renderDialog() {
	const onSuccess = vi.fn();
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<ProjectDialog
				organizationId="org-1"
				project={null}
				open
				onOpenChange={() => {}}
				onSuccess={onSuccess}
			/>
		</QueryClientProvider>,
	);
	return { onSuccess };
}

describe("ProjectDialog, starting from a template", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		customerActions.getCustomersForSelection.mockResolvedValue({
			success: true,
			data: [{ id: "customer-1", name: "Acme" }],
		});
		fromTemplateActions.getProjectTemplateChoices.mockResolvedValue({
			success: true,
			data: [relaunchSummary],
		});
		fromTemplateActions.getProjectTemplatePreview.mockResolvedValue({
			success: true,
			data: relaunchPreview,
		});
		fromTemplateActions.createProjectFromTemplate.mockResolvedValue({
			success: true,
			data: { id: "project-1", skipped: [] },
		});
	});

	it("shows what the template copies, and who will be skipped, instead of the copied fields", async () => {
		const user = userEvent.setup();
		renderDialog();

		const startFrom = await screen.findByRole("combobox", { name: "Start from" });
		await within(startFrom).findByRole("option", { name: "Website relaunch" });
		expect(screen.getByLabelText("Budget (hours)")).toBeTruthy();

		await user.selectOptions(startFrom, "template-1");

		const preview = await screen.findByRole("region", { name: "From Website relaunch" });
		expect(within(preview).getByText("2 tasks")).toBeTruthy();
		expect(within(preview).getByText("120 h budget")).toBeTruthy();
		expect(within(preview).getByText("Deadline 30 days after creation")).toBeTruthy();
		expect(within(preview).getByText("Lee Left: left the organization")).toBeTruthy();
		expect(within(preview).getByText("Old team: no longer exists")).toBeTruthy();
		expect(screen.queryByLabelText("Budget (hours)")).toBeNull();
		expect(screen.queryByLabelText("Deadline")).toBeNull();
	});

	it("creates the project from the template with its name, customer and status", async () => {
		const user = userEvent.setup();
		const { onSuccess } = renderDialog();

		const startFrom = await screen.findByRole("combobox", { name: "Start from" });
		await within(startFrom).findByRole("option", { name: "Website relaunch" });
		await user.selectOptions(startFrom, "template-1");
		await user.type(screen.getByLabelText(/^Name/), "Acme relaunch");
		const customer = await screen.findByRole("combobox", { name: "Customer" });
		await within(customer).findByRole("option", { name: "Acme" });
		await user.selectOptions(customer, "customer-1");
		await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "active");
		await user.click(screen.getByRole("button", { name: "Create Project" }));

		expect(fromTemplateActions.createProjectFromTemplate).toHaveBeenCalledWith({
			templateId: "template-1",
			name: "Acme relaunch",
			description: null,
			status: "active",
			customerId: "customer-1",
		});
		expect(projectActions.createProject).not.toHaveBeenCalled();
		expect(toast.success).toHaveBeenCalledWith("Project created");
		expect(toast.warning).not.toHaveBeenCalled();
		expect(onSuccess).toHaveBeenCalled();
	});

	it("tells the creator which managers and assignments were skipped, and why", async () => {
		const user = userEvent.setup();
		fromTemplateActions.createProjectFromTemplate.mockResolvedValue({
			success: true,
			data: {
				id: "project-1",
				skipped: [
					{ role: "manager", name: "Lee Left", reason: "departed" },
					{ role: "team", name: "Old team", reason: "removed" },
				],
			},
		});
		renderDialog();

		const startFrom = await screen.findByRole("combobox", { name: "Start from" });
		await within(startFrom).findByRole("option", { name: "Website relaunch" });
		await user.selectOptions(startFrom, "template-1");
		await user.type(screen.getByLabelText(/^Name/), "Acme relaunch");
		await user.click(screen.getByRole("button", { name: "Create Project" }));

		expect(toast.warning).toHaveBeenCalledWith(
			"Not copied: Lee Left (left the organization), Old team (no longer exists)",
		);
	});

	it("reports a refused creation, such as a name already in use", async () => {
		const user = userEvent.setup();
		fromTemplateActions.createProjectFromTemplate.mockResolvedValue({
			success: false,
			error: "A project with this name already exists",
		});
		const { onSuccess } = renderDialog();

		const startFrom = await screen.findByRole("combobox", { name: "Start from" });
		await within(startFrom).findByRole("option", { name: "Website relaunch" });
		await user.selectOptions(startFrom, "template-1");
		await user.type(screen.getByLabelText(/^Name/), "Acme relaunch");
		await user.click(screen.getByRole("button", { name: "Create Project" }));

		expect(toast.error).toHaveBeenCalledWith("A project with this name already exists");
		expect(onSuccess).not.toHaveBeenCalled();
	});

	it("still creates a blank project the usual way", async () => {
		const user = userEvent.setup();
		projectActions.createProject.mockResolvedValue({ success: true, data: { id: "p" } });
		renderDialog();

		await screen.findByRole("combobox", { name: "Start from" });
		await user.type(screen.getByLabelText(/^Name/), "Blank one");
		await user.click(screen.getByRole("button", { name: "Create Project" }));

		expect(projectActions.createProject).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1", name: "Blank one" }),
		);
		expect(fromTemplateActions.createProjectFromTemplate).not.toHaveBeenCalled();
	});
});
