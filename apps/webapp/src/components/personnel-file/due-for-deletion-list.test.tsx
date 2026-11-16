// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { DueDocumentsResult } from "@/lib/personnel-file/retention-store";
import { DueForDeletionList } from "./due-for-deletion-list";

const boundary = vi.hoisted(() => ({
	read: vi.fn(),
	purge: vi.fn(),
	scope: {
		userId: "actor",
		activeOrganizationId: "org",
		employeeId: "self",
		isLoading: false,
		error: null,
	},
}));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => boundary.scope,
}));
vi.mock("@/app/[locale]/(app)/personnel-files/retention-actions", () => ({
	getDueForDeletionAction: boundary.read,
	purgeDueDocumentsAction: boundary.purge,
}));
vi.mock("@/components/providers/app-locale-provider", () => ({
	useAppLocale: () => "en-GB",
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, key: string) => String(params?.[key] ?? match)),
	}),
}));

const due = {
	id: "due",
	employeeId: "former",
	employeeName: "Former Person",
	employeeNumber: "0042",
	category: "payslip" as const,
	title: "Retained payslip",
	documentDate: "2018-12-31",
	payPeriod: { year: 2018, month: 12 },
	retentionYears: 6,
	retentionStart: "2020-01-01",
	dueOn: "2026-01-01",
};
const unknown = {
	id: "unknown",
	employeeId: "legacy",
	employeeName: "Legacy Person",
	employeeNumber: null,
	category: "other" as const,
	title: "Unknown end",
	documentDate: "2015-01-01",
	payPeriod: null,
	retentionYears: 2,
};
const data: DueDocumentsResult = {
	today: "2026-11-15",
	documents: [due],
	unknownStart: [unknown],
};
function mount() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const tree = (mode: "visible" | "hidden" = "visible") => (
		<QueryClientProvider client={client}>
			<Activity mode={mode}>
				<DueForDeletionList />
			</Activity>
		</QueryClientProvider>
	);
	const rendered = render(tree());
	return {
		...rendered,
		client,
		show: (mode: "visible" | "hidden" = "visible") => rendered.rerender(tree(mode)),
	};
}
beforeEach(() => {
	vi.clearAllMocks();
	boundary.scope = {
		userId: "actor",
		activeOrganizationId: "org",
		employeeId: "self",
		isLoading: false,
		error: null,
	};
	boundary.read.mockResolvedValue({ success: true, data });
	boundary.purge.mockResolvedValue({
		success: false,
		error: "Permission changed. Review your scope.",
	});
});

it("retains confirmation and selection with an inline failed-command retry", async () => {
	mount();
	await screen.findByText(due.title);
	fireEvent.click(screen.getByText(due.title));
	fireEvent.click(screen.getByRole("button", { name: /Purge|Review selected/ }));
	const dialog = await screen.findByRole("alertdialog");
	fireEvent.click(within(dialog).getByRole("button", { name: "Purge" }));
	await waitFor(() =>
		expect(within(dialog).getByRole("alert").textContent).toContain("Permission changed"),
	);
	expect(boundary.purge).toHaveBeenCalledWith({
		documentIds: ["due"],
		scope: { userId: "actor", organizationId: "org" },
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function selectDue() {
	await screen.findByText(due.title);
	fireEvent.click(
		screen.getByRole("checkbox", {
			name: `Select ${due.title} for ${due.employeeName}`,
		}),
	);
	fireEvent.click(screen.getByRole("button", { name: "Review selected documents" }));
	return screen.findByRole("alertdialog");
}

it("starts unselected, keeps unknown records separate and excludes them from due select-all", async () => {
	mount();
	const list = await screen.findByRole("list", {
		name: "Retention start unknown",
	});
	expect(within(list).getByText("Employment end unknown")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Review selected documents" }).hasAttribute("disabled"),
	).toBe(true);
	fireEvent.click(screen.getByRole("checkbox", { name: "Select due documents (up to 500)" }));
	expect(within(list).getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
	fireEvent.click(within(list).getByRole("checkbox"));
	fireEvent.click(screen.getByRole("button", { name: "Review selected documents" }));
	const dialog = await screen.findByRole("alertdialog");
	expect(within(dialog).getByText(/They are not known to be due/)).toBeTruthy();
	expect(within(dialog).getAllByRole("link")).toHaveLength(2);
	fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	expect(screen.getByText("Selected: 2 of 500 maximum")).toBeTruthy();
	expect(boundary.purge).not.toHaveBeenCalled();
});

it("prevents duplicate commands and dismissal while pending, then retries the same selection", async () => {
	const command = deferred<{ success: false; error: string }>();
	boundary.purge.mockReturnValueOnce(command.promise);
	mount();
	const dialog = await selectDue();
	const purge = within(dialog).getByRole("button", { name: "Purge" });
	fireEvent.click(purge);
	fireEvent.click(purge);
	fireEvent.keyDown(dialog, { key: "Escape" });
	expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(
		true,
	);
	expect(boundary.purge).toHaveBeenCalledTimes(1);
	await act(async () => command.resolve({ success: false, error: "Try again" }));
	fireEvent.click(within(dialog).getByRole("button", { name: "Retry purge" }));
	await waitFor(() => expect(boundary.purge).toHaveBeenCalledTimes(2));
	expect(boundary.purge.mock.calls[0]).toEqual(boundary.purge.mock.calls[1]);
});

it("reports partial outcomes and refreshes records without selecting untouched documents", async () => {
	boundary.purge.mockResolvedValueOnce({
		success: true,
		data: { purged: ["due"], skipped: ["gone"] },
	});
	mount();
	const dialog = await selectDue();
	boundary.read.mockResolvedValue({
		success: true,
		data: { ...data, documents: [] },
	});
	fireEvent.click(within(dialog).getByRole("button", { name: "Purge" }));
	await screen.findByText("Purged: 1. Skipped: 1.");
	await screen.findByText("No documents in your scope are due for deletion.");
	expect(screen.getByText(/Skipped documents were not purged/)).toBeTruthy();
	expect(screen.getByText(unknown.title)).toBeTruthy();
	expect(screen.getByText("Selected: 0 of 500 maximum")).toBeTruthy();
});

it("recovers from rejected reads without presenting unknown data as zero", async () => {
	boundary.read.mockRejectedValueOnce(new Error("Transport unavailable"));
	mount();
	await screen.findByRole("alert");
	expect(screen.queryByText("No documents in your scope are due for deletion.")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByText(due.title);
});

it.each(["activeOrganizationId", "userId", "employeeId"] as const)(
	"retires old evidence, selection and late command feedback after %s changes away and back",
	async (field) => {
		const command = deferred<{
			success: true;
			data: { purged: string[]; skipped: string[] };
		}>();
		boundary.purge.mockReturnValueOnce(command.promise);
		const view = mount();
		const dialog = await selectDue();
		fireEvent.click(within(dialog).getByRole("button", { name: "Purge" }));
		const original = boundary.scope[field];
		boundary.scope = { ...boundary.scope, [field]: "different" };
		boundary.read.mockResolvedValue({
			success: true,
			data: { ...data, documents: [] },
		});
		view.show();
		expect(screen.queryByRole("alertdialog")).toBeNull();
		boundary.scope = { ...boundary.scope, [field]: original };
		view.show();
		await act(async () =>
			command.resolve({
				success: true,
				data: { purged: ["due"], skipped: [] },
			}),
		);
		await screen.findByText("No documents in your scope are due for deletion.");
		expect(screen.queryByText("Purged: 1. Skipped: 0.")).toBeNull();
		expect(screen.getByText("Selected: 0 of 500 maximum")).toBeTruthy();
	},
);

it("discards a late read across an organization roundtrip", async () => {
	const read = deferred<{ success: true; data: DueDocumentsResult }>();
	boundary.read.mockReturnValueOnce(read.promise);
	const view = mount();
	boundary.scope = { ...boundary.scope, activeOrganizationId: "different" };
	boundary.read.mockResolvedValue({
		success: true,
		data: { ...data, documents: [] },
	});
	view.show();
	boundary.scope = { ...boundary.scope, activeOrganizationId: "org" };
	view.show();
	await act(async () => read.resolve({ success: true, data }));
	await screen.findByText("No documents in your scope are due for deletion.");
	expect(screen.queryByText(due.title)).toBeNull();
});

it("retires pending work while Activity is hidden and rereads before showing retained selection", async () => {
	const command = deferred<{ success: false; error: string }>();
	boundary.purge.mockReturnValueOnce(command.promise);
	const view = mount();
	const dialog = await selectDue();
	fireEvent.click(within(dialog).getByRole("button", { name: "Purge" }));
	view.show("hidden");
	await act(async () => command.resolve({ success: false, error: "Old hidden failure" }));
	view.show();
	await screen.findByText(due.title);
	expect(screen.queryByRole("alertdialog")).toBeNull();
	expect(screen.queryByText("Old hidden failure")).toBeNull();
	expect(screen.getByText("Selected: 0 of 500 maximum")).toBeTruthy();
});

it("retains selected IDs across pages and opens only those records for confirmation", async () => {
	boundary.read.mockResolvedValue({
		success: true,
		data: {
			...data,
			documents: Array.from({ length: 21 }, (_, i) => ({
				...due,
				id: `due-${i}`,
				title: `Payslip ${i}`,
			})),
		},
	});
	mount();
	await screen.findByText("Payslip 0");
	fireEvent.click(
		screen.getByRole("checkbox", {
			name: "Select Payslip 0 for Former Person",
		}),
	);
	fireEvent.click(screen.getByRole("button", { name: "Next" }));
	fireEvent.click(
		screen.getByRole("checkbox", {
			name: "Select Payslip 20 for Former Person",
		}),
	);
	fireEvent.click(screen.getByRole("button", { name: "Review selected documents" }));
	const dialog = await screen.findByRole("alertdialog");
	expect(within(dialog).getByText("Payslip 0")).toBeTruthy();
	expect(within(dialog).getByText("Payslip 20")).toBeTruthy();
	expect(within(dialog).queryByText("Payslip 1")).toBeNull();
});

it("keeps selection during a shared query refresh and retries with fresh evidence", async () => {
	const view = mount();
	await screen.findByText(due.title);
	fireEvent.click(
		screen.getByRole("checkbox", {
			name: `Select ${due.title} for ${due.employeeName}`,
		}),
	);
	boundary.read.mockResolvedValue({
		success: true,
		data: { ...data, documents: [{ ...due, title: "Updated title" }] },
	});
	await act(async () => {
		await view.client.invalidateQueries();
	});
	await screen.findByText("Updated title");
	expect(screen.getByText("Selected: 1 of 500 maximum")).toBeTruthy();
});

it("releases capacity when selected documents leave the refreshed result", async () => {
	boundary.read.mockResolvedValueOnce({
		success: true,
		data: {
			...data,
			documents: Array.from({ length: 500 }, (_, index) => ({
				...due,
				id: `old-${index}`,
				title: `Old document ${index}`,
			})),
			unknownStart: [],
		},
	});
	const view = mount();
	await screen.findByText("Old document 0");
	fireEvent.click(screen.getByRole("checkbox", { name: "Select due documents (up to 500)" }));
	expect(screen.getByText("Selected: 500 of 500 maximum")).toBeTruthy();
	boundary.read.mockResolvedValue({
		success: true,
		data: { ...data, documents: [{ ...due, id: "new", title: "Newly due" }] },
	});
	await act(async () => {
		await view.client.invalidateQueries();
	});
	const checkbox = await screen.findByRole("checkbox", {
		name: "Select Newly due for Former Person",
	});
	expect(screen.getByText("Selected: 0 of 500 maximum")).toBeTruthy();
	expect(checkbox.getAttribute("aria-disabled")).not.toBe("true");
	fireEvent.click(checkbox);
	expect(checkbox.getAttribute("aria-checked")).toBe("true");
	fireEvent.click(checkbox);
	fireEvent.click(screen.getByRole("checkbox", { name: "Select due documents (up to 500)" }));
	expect(checkbox.getAttribute("aria-checked")).toBe("true");
	expect(
		screen
			.getByRole("checkbox", { name: "Select Unknown end for Legacy Person" })
			.getAttribute("aria-checked"),
	).toBe("false");
	fireEvent.click(screen.getByRole("button", { name: "Review selected documents" }));
	const dialog = await screen.findByRole("alertdialog");
	expect(within(dialog).getByText("Newly due")).toBeTruthy();
	expect(within(dialog).getAllByRole("link")).toHaveLength(1);
	expect(boundary.purge).not.toHaveBeenCalled();
});
