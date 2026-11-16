/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ServerActionResult } from "@/lib/effect/result";
import type { VehicleDistanceReport } from "@/lib/reports/vehicle-distance-report";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { VehicleDistanceReportContainer } from "./vehicle-distance-report-container";

const boundary = vi.hoisted(() => ({
	scope: {
		userId: "user-a",
		activeOrganizationId: "org-a",
		organizationId: "org-a",
		employeeId: "employee-a",
		role: "admin",
		isLoading: false,
		error: null,
	},
	pending: false,
	read: vi.fn(),
	refresh: undefined as undefined | (() => Promise<unknown>),
	pdf: vi.fn(),
}));
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => boundary.scope,
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		isPending: boundary.pending,
		data: {
			user: { id: boundary.scope.userId },
			session: { activeOrganizationId: boundary.scope.activeOrganizationId },
		},
	}),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, key) => String(values?.[key] ?? match)),
	}),
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en-US",
		timezone: "Europe/Berlin",
		timeFormat: "24h",
	}),
}));
vi.mock("@/app/[locale]/(app)/reports/vehicles/actions", () => ({
	getVehicleDistanceReport: boundary.read,
}));
vi.mock("@/components/providers/view-refresh-provider", () => ({
	useViewRefresh: (handler: () => Promise<unknown>) => {
		boundary.refresh = handler;
	},
}));
vi.mock("@/lib/reports/exporters/report-document-pdf", () => ({
	exportReportDocumentToPDF: boundary.pdf,
}));

const report: VehicleDistanceReport = {
	period: { fromDay: "2026-01-01", toDay: "2026-12-31" },
	months: ["2026-01", "2026-02"],
	monthlyKm: [101, 29],
	totalKm: 130,
	vehicles: [
		{
			vehicle: {
				kind: "organization",
				id: "van",
				name: "Archived van",
				licencePlate: "B-123",
				archived: true,
			},
			monthlyKm: [101, 0],
			totalKm: 101,
			employees: [
				{
					employeeId: "a",
					employeeName: "Alice",
					monthlyKm: [101, 0],
					totalKm: 101,
				},
			],
		},
		{
			vehicle: { kind: "own" },
			monthlyKm: [0, 29],
			totalKm: 29,
			employees: [
				{
					employeeId: "b",
					employeeName: "Bob",
					monthlyKm: [0, 29],
					totalKm: 29,
				},
			],
		},
	],
};
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function generate() {
	fireEvent.click(screen.getByRole("button", { name: "Generate report" }));
	await waitFor(() => expect(boundary.read).toHaveBeenCalled());
}
beforeEach(() => {
	boundary.scope = {
		userId: "user-a",
		activeOrganizationId: "org-a",
		organizationId: "org-a",
		employeeId: "employee-a",
		role: "admin",
		isLoading: false,
		error: null,
	};
	boundary.pending = false;
	boundary.read.mockReset();
	boundary.pdf.mockReset();
	useOrganizationSettings.setState({
		isHydrated: true,
		organizationId: "org-a",
		timezone: "Europe/Berlin",
	});
});
afterEach(cleanup);

it("retires an in-flight organization A read across A to B to A", async () => {
	const held = deferred<ServerActionResult<VehicleDistanceReport>>();
	boundary.read.mockReturnValue(held.promise);
	const view = render(<VehicleDistanceReportContainer />);
	await generate();
	boundary.scope = {
		...boundary.scope,
		activeOrganizationId: "org-b",
		organizationId: "org-b",
	};
	view.rerender(<VehicleDistanceReportContainer />);
	boundary.scope = {
		...boundary.scope,
		activeOrganizationId: "org-a",
		organizationId: "org-a",
	};
	view.rerender(<VehicleDistanceReportContainer />);
	await act(async () => held.resolve({ success: true, data: report }));
	expect(screen.queryByText("Archived van")).toBeNull();
	expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
});

it.each(["account", "validation", "role"])(
	"retires reads across a %s arrival and return",
	async (change) => {
		const held = deferred<ServerActionResult<VehicleDistanceReport>>();
		boundary.read.mockReturnValue(held.promise);
		const view = render(<VehicleDistanceReportContainer />);
		await generate();
		const original = boundary.scope;
		if (change === "account") boundary.scope = { ...original, userId: "user-b" };
		if (change === "validation") boundary.pending = true;
		if (change === "role") boundary.scope = { ...original, role: "employee" };
		view.rerender(<VehicleDistanceReportContainer />);
		boundary.scope = original;
		boundary.pending = false;
		view.rerender(<VehicleDistanceReportContainer />);
		await act(async () => held.resolve({ success: true, data: report }));
		expect(screen.queryByText("Archived van")).toBeNull();
	},
);

it("refuses a form validation continuation after its requesting arrival retires", async () => {
	boundary.read.mockResolvedValue({ success: true, data: report });
	const view = render(<VehicleDistanceReportContainer />);
	fireEvent.click(screen.getByRole("button", { name: "Generate report" }));
	boundary.pending = true;
	view.rerender(<VehicleDistanceReportContainer />);
	await act(async () => {});
	expect(boundary.read).not.toHaveBeenCalled();
	boundary.pending = false;
	view.rerender(<VehicleDistanceReportContainer />);
	await generate();
	expect(await screen.findByText("Archived van")).toBeTruthy();
});

it("retires an Activity-hidden read and unlocks a fresh generation on return", async () => {
	const held = deferred<ServerActionResult<VehicleDistanceReport>>();
	boundary.read
		.mockReturnValueOnce(held.promise)
		.mockResolvedValue({ success: true, data: report });
	const view = render(
		<Activity mode="visible">
			<VehicleDistanceReportContainer />
		</Activity>,
	);
	await generate();
	view.rerender(
		<Activity mode="hidden">
			<VehicleDistanceReportContainer />
		</Activity>,
	);
	view.rerender(
		<Activity mode="visible">
			<VehicleDistanceReportContainer />
		</Activity>,
	);
	await act(async () => held.resolve({ success: true, data: { ...report, totalKm: 999 } }));
	expect(screen.queryByText("Archived van")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Generate report" }));
	expect(await screen.findByText("Archived van")).toBeTruthy();
	expect(screen.queryByText("999 km")).toBeNull();
});

it("keeps successful rows after failed refresh, disables downloads and retries the generated range", async () => {
	boundary.read
		.mockResolvedValueOnce({ success: true, data: report })
		.mockRejectedValueOnce(new Error("Network unavailable"))
		.mockResolvedValue({ success: true, data: { ...report, totalKm: 135 } });
	render(<VehicleDistanceReportContainer />);
	await generate();
	await screen.findByText("Archived van");
	await act(async () => {
		await boundary.refresh?.();
	});
	expect(screen.getByText("Archived van")).toBeTruthy();
	expect(screen.getByText("Network unavailable")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findAllByText("135 km");
	expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy();
	expect(boundary.read.mock.calls[2]).toEqual(boundary.read.mock.calls[0]);
});

it("distinguishes ungenerated, generating and an empty completed report", async () => {
	const held = deferred<ServerActionResult<VehicleDistanceReport>>();
	boundary.read.mockReturnValue(held.promise);
	render(<VehicleDistanceReportContainer />);
	expect(screen.getByText("No report generated yet")).toBeTruthy();
	expect(screen.queryByText("No driving in this period")).toBeNull();
	await generate();
	expect(screen.queryByText("No driving in this period")).toBeNull();
	await act(async () =>
		held.resolve({
			success: true,
			data: { ...report, vehicles: [], totalKm: 0, monthlyKm: [0, 0] },
		}),
	);
	expect(screen.getByText("No driving in this period")).toBeTruthy();
	expect(screen.getByText("0 km")).toBeTruthy();
});

it.each(["organization", "account", "validation", "Activity", "replacement"])(
	"prevents duplicate Generate and retired %s exports",
	async (change) => {
		const read = deferred<ServerActionResult<VehicleDistanceReport>>();
		boundary.read.mockReturnValue(read.promise);
		const held = deferred<Uint8Array>();
		boundary.pdf.mockReturnValue(held.promise);
		const view = render(
			<Activity mode="visible">
				<VehicleDistanceReportContainer />
			</Activity>,
		);
		const button = screen.getByRole("button", { name: "Generate report" });
		fireEvent.click(button);
		fireEvent.click(button);
		await waitFor(() => expect(boundary.read).toHaveBeenCalledTimes(1));
		await act(async () => read.resolve({ success: true, data: report }));
		const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
		const createURL = vi.fn(() => "blob:vehicle-report");
		vi.stubGlobal(
			"URL",
			Object.assign(URL, {
				createObjectURL: createURL,
				revokeObjectURL: vi.fn(),
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
		await waitFor(() => expect(boundary.pdf).toHaveBeenCalled());
		const original = boundary.scope;
		if (change === "organization") boundary.scope = { ...original, activeOrganizationId: "org-b" };
		if (change === "account") boundary.scope = { ...original, userId: "user-b" };
		if (change === "validation") boundary.pending = true;
		if (change === "replacement") {
			boundary.read.mockResolvedValue({ success: true, data: report });
			fireEvent.click(screen.getByRole("button", { name: "Generate report" }));
			await waitFor(() => expect(boundary.read).toHaveBeenCalledTimes(2));
		}
		view.rerender(
			<Activity mode={change === "Activity" ? "hidden" : "visible"}>
				<VehicleDistanceReportContainer />
			</Activity>,
		);
		boundary.scope = original;
		boundary.pending = false;
		view.rerender(
			<Activity mode="visible">
				<VehicleDistanceReportContainer />
			</Activity>,
		);
		await act(async () => held.resolve(new Uint8Array([1, 2])));
		expect(click).not.toHaveBeenCalled();
		expect(createURL).not.toHaveBeenCalled();
		click.mockRestore();
	},
);

it("stages a new period without relabeling the generated report or changing global Refresh scope", async () => {
	boundary.read.mockResolvedValue({ success: true, data: report });
	render(<VehicleDistanceReportContainer />);
	await generate();
	await screen.findByText("Archived van");
	fireEvent.click(screen.getByRole("combobox", { name: "Period" }));
	fireEvent.click(await screen.findByRole("option", { name: "Last Month" }));
	expect(
		screen.getByText("Period changed. Generate report to update the results and downloads."),
	).toBeTruthy();
	expect(boundary.read).toHaveBeenCalledTimes(1);
	await act(async () => {
		await boundary.refresh?.();
	});
	expect(boundary.read.mock.calls[1]).toEqual(boundary.read.mock.calls[0]);
	expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Generate report" }));
	await waitFor(() => expect(boundary.read).toHaveBeenCalledTimes(3));
	expect(boundary.read.mock.calls[2]).not.toEqual(boundary.read.mock.calls[0]);
});
