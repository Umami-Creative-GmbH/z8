/* @vitest-environment jsdom */

import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query/keys";
import type { SurchargeModelWithRules } from "@/lib/surcharges/validation";
import { SurchargeAssignmentDialog } from "./surcharge-assignment-dialog";
import { SurchargeManagement } from "./surcharge-management";
import { SurchargeModelDialog } from "./surcharge-model-dialog";

const actions = vi.hoisted(() => ({
	create: vi.fn(),
	update: vi.fn(),
	read: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/surcharges/actions", () => ({
	createSurchargeModel: actions.create,
	updateSurchargeModel: actions.update,
	getSurchargeModels: actions.read,
	deleteSurchargeModel: vi.fn(),
	createSurchargeAssignment: vi.fn(),
	getTeamsForAssignment: vi.fn(),
}));
vi.mock("./surcharge-assignment-manager", () => ({
	SurchargeAssignmentManager: () => null,
}));
vi.mock("./surcharge-reports/surcharge-reports-root", () => ({
	SurchargeReports: () => null,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	Element.prototype.hasPointerCapture = vi.fn(() => false);
	Element.prototype.setPointerCapture = vi.fn();
	Element.prototype.releasePointerCapture = vi.fn();
	Element.prototype.scrollIntoView = vi.fn();
});

const model: SurchargeModelWithRules = {
	id: "model-a",
	organizationId: "org-a",
	name: "Weekend",
	description: "Weekend premium",
	isActive: true,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	createdBy: "user-a",
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	updatedBy: null,
	rules: [
		{
			id: "rule-a",
			name: "Sunday",
			description: null,
			ruleType: "day_of_week",
			percentage: "0.5",
			dayOfWeek: "sunday",
			windowStartTime: null,
			windowEndTime: null,
			specificDate: null,
			dateRangeStart: null,
			dateRangeEnd: null,
			priority: 0,
			validFrom: null,
			validUntil: null,
			isActive: true,
			createdAt: new Date("2026-01-01T00:00:00Z"),
			createdBy: "user-a",
		},
	],
};

function Read({
	family,
	load,
}: {
	family: readonly unknown[];
	load: () => Promise<string>;
}) {
	const query = useQuery({
		queryKey: family,
		queryFn: load,
		staleTime: Infinity,
	});
	return <p>{query.data}</p>;
}

describe("surcharge model save refresh", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actions.update.mockResolvedValue({ success: true, data: undefined });
		actions.read.mockResolvedValue({ success: true, data: [model] });
	});
	it("shares one model read between the visible catalog and assignment selector", async () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<SurchargeManagement canManage={false} organizationId="org-a" />
				<SurchargeAssignmentDialog
					open
					onOpenChange={vi.fn()}
					organizationId="org-a"
					assignmentType="organization"
					onSuccess={vi.fn()}
				/>
			</QueryClientProvider>,
		);
		await screen.findByText("Weekend");
		expect(actions.read).toHaveBeenCalledTimes(1);
	});
	it.each(["refused", "network failure"])(
		"keeps a %s edit without claiming success or reloading model data",
		async (failure) => {
			actions.update.mockImplementation(() =>
				failure === "refused"
					? Promise.resolve({ success: false, error: "Not accepted" })
					: Promise.reject(new Error("Offline")),
			);
			const saved = vi.fn();
			render(
				<QueryClientProvider client={new QueryClient()}>
					<SurchargeModelDialog
						open
						onOpenChange={vi.fn()}
						organizationId="org-a"
						editingModel={model}
						onSuccess={saved}
					/>
				</QueryClientProvider>,
			);
			const input = await screen.findByLabelText("Model Name");
			fireEvent.change(input, { target: { value: "Unsaved weekend" } });
			const save = screen.getByRole("button", { name: "Save" });
			fireEvent.click(save);
			await waitFor(() => expect(actions.update).toHaveBeenCalledTimes(1));
			await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
			expect((input as HTMLInputElement).value).toBe("Unsaved weekend");
			expect(saved).not.toHaveBeenCalled();
			expect(actions.read).not.toHaveBeenCalled();
		},
	);
	it("refreshes only the organization model catalog after creating a model", async () => {
		actions.create.mockResolvedValue({
			success: true,
			data: { id: "new-model" },
		});
		const list = vi.fn().mockResolvedValue("Model catalog");
		const assignments = vi.fn().mockResolvedValue("Unchanged assignments");
		const other = vi.fn().mockResolvedValue("Other organization");
		const saved = vi.fn();
		render(
			<QueryClientProvider client={new QueryClient()}>
				<Read family={queryKeys.surcharges.models.list("org-a")} load={list} />
				<Read
					family={queryKeys.surcharges.assignments.list("org-a")}
					load={assignments}
				/>
				<Read family={queryKeys.surcharges.models.list("org-b")} load={other} />
				<SurchargeModelDialog
					open
					onOpenChange={vi.fn()}
					organizationId="org-a"
					editingModel={null}
					onSuccess={saved}
				/>
			</QueryClientProvider>,
		);
		await screen.findByText("Model catalog");
		fireEvent.change(screen.getByLabelText("Model Name"), {
			target: { value: "New model" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add Rule" }));
		fireEvent.change(screen.getByLabelText("Rule Name"), {
			target: { value: "Sunday" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
		expect(actions.create).toHaveBeenCalledWith(
			"org-a",
			expect.objectContaining({ name: "New model" }),
		);
		expect(list).toHaveBeenCalledTimes(2);
		expect(assignments).toHaveBeenCalledTimes(1);
		expect(other).toHaveBeenCalledTimes(1);
	});
	it("keeps a different selected form open when an older model save finishes", async () => {
		let finish!: (result: { success: true; data: undefined }) => void;
		actions.update.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const saved = vi.fn();
		const client = new QueryClient();
		const draw = (selected: SurchargeModelWithRules) => (
			<QueryClientProvider client={client}>
				<SurchargeModelDialog
					open
					onOpenChange={vi.fn()}
					organizationId={selected.organizationId}
					editingModel={selected}
					onSuccess={saved}
				/>
			</QueryClientProvider>
		);
		const view = render(draw(model));
		fireEvent.change(await screen.findByLabelText("Model Name"), {
			target: { value: "Accepted old model" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(actions.update).toHaveBeenCalledTimes(1));
		view.rerender(
			draw({
				...model,
				id: "model-b",
				organizationId: "org-b",
				name: "New selection",
			}),
		);
		await screen.findByDisplayValue("New selection");
		await act(async () => finish({ success: true, data: undefined }));
		expect(screen.getByDisplayValue("New selection")).toBeTruthy();
		expect(saved).not.toHaveBeenCalled();
	});
	it("shows an accepted catalog save through one immediate read without unmounting unrelated data", async () => {
		let name = model.name;
		actions.read.mockImplementation(async () => ({
			success: true,
			data: [{ ...model, name }],
		}));
		actions.update.mockImplementation(
			async (_id: string, value: { name: string }) => {
				name = value.name;
				return { success: true, data: undefined };
			},
		);
		const unrelated = vi.fn().mockResolvedValue("Preserved dashboard");
		render(
			<QueryClientProvider
				client={
					new QueryClient({ defaultOptions: { queries: { retry: false } } })
				}
			>
				<Read family={["dashboard", "another-dataset"]} load={unrelated} />
				<SurchargeManagement canManage organizationId="org-a" />
			</QueryClientProvider>,
		);
		await screen.findByText("Weekend");
		fireEvent.click(
			screen.getByRole("button", { name: "Edit Surcharge Model" }),
		);
		fireEvent.change(await screen.findByLabelText("Model Name"), {
			target: { value: "Accepted weekend" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await screen.findByText("Accepted weekend");
		expect(actions.read).toHaveBeenCalledTimes(2);
		expect(actions.update).toHaveBeenCalledTimes(1);
		expect(unrelated).toHaveBeenCalledTimes(1);
	});
	it("keeps the catalog and exposes retry when the accepted save's read fails", async () => {
		actions.read
			.mockResolvedValueOnce({ success: true, data: [model] })
			.mockResolvedValueOnce({
				success: false,
				error: "Temporary model read failure",
			})
			.mockResolvedValue({
				success: true,
				data: [{ ...model, name: "Accepted weekend" }],
			});
		render(
			<QueryClientProvider
				client={
					new QueryClient({ defaultOptions: { queries: { retry: false } } })
				}
			>
				<SurchargeManagement canManage organizationId="org-a" />
			</QueryClientProvider>,
		);
		await screen.findByText("Weekend");
		fireEvent.click(
			screen.getByRole("button", { name: "Edit Surcharge Model" }),
		);
		fireEvent.change(await screen.findByLabelText("Model Name"), {
			target: { value: "Accepted weekend" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByText("Weekend")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await screen.findByText("Accepted weekend");
		expect(actions.update).toHaveBeenCalledTimes(1);
		expect(actions.read).toHaveBeenCalledTimes(3);
	});
	it("refreshes affected model and assignment reads once while another organization and Dashboard stay warm", async () => {
		const list = vi.fn().mockResolvedValue("Model list");
		const detail = vi.fn().mockResolvedValue("Model detail");
		const assignments = vi.fn().mockResolvedValue("Assignment labels");
		const otherOrganization = vi
			.fn()
			.mockResolvedValue("Other organization model");
		const dashboard = vi.fn().mockResolvedValue("Dashboard history");
		const saved = vi.fn();
		render(
			<QueryClientProvider
				client={
					new QueryClient({ defaultOptions: { queries: { retry: false } } })
				}
			>
				<Read family={queryKeys.surcharges.models.list("org-a")} load={list} />
				<Read
					family={queryKeys.surcharges.models.detail(model.id)}
					load={detail}
				/>
				<Read
					family={queryKeys.surcharges.assignments.list("org-a")}
					load={assignments}
				/>
				<Read
					family={queryKeys.surcharges.models.list("org-b")}
					load={otherOrganization}
				/>
				<Read family={["dashboard", "unrelated"]} load={dashboard} />
				<SurchargeModelDialog
					open
					onOpenChange={vi.fn()}
					organizationId="org-a"
					editingModel={model}
					onSuccess={saved}
				/>
			</QueryClientProvider>,
		);
		await screen.findByText("Dashboard history");
		fireEvent.change(screen.getByLabelText("Model Name"), {
			target: { value: "Updated weekend" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
		expect(dashboard).toHaveBeenCalledTimes(1);
		expect(otherOrganization).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
		expect(detail).toHaveBeenCalledTimes(2);
		expect(assignments).toHaveBeenCalledTimes(2);
	});
});
