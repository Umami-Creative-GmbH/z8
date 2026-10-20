// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrivingLicenceEmployeeRecord } from "@/lib/organization/driving-licence/checks";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: "driver" }, session: { activeOrganizationId: "org" } },
	}),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
			fallback.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? key)),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("@/lib/organization/driving-licence/history-actions", () => ({
	getDrivingLicenceHistoryAction: async () => ({
		success: true,
		data: {
			employeeId: "driver-employee",
			canSupplement: false,
			period: { from: null, to: null },
			authorization: { status: "partially_active" },
			checks: [],
			supplements: [],
			events: [],
		},
	}),
	supplementDrivingLicenceCheckAction: vi.fn(),
}));
vi.mock("@/lib/organization/driving-licence/impediment-actions", () => ({
	reportDrivingImpedimentAction: vi.fn(),
}));
const { MyDrivingLicence } = await import("./my-licence");

const record = {
	enrolled: true,
	status: "partially_active",
	authorizedClasses: ["B"],
	timezone: "Europe/Berlin",
	uncertainEmailCount: 0,
	classes: [
		{
			code: "B",
			status: "active",
			reason: null,
			validThrough: "2026-07-31",
			deadlineTimezone: "Europe/Berlin",
			expiresAt: "2026-07-31T22:00:00.000Z",
			lastSuccessfulAt: "2026-01-31T11:00:00.000Z",
			supportingCheckId: "check",
			restrictions: "Corrective lenses",
		},
		{
			code: "C",
			status: "suspended",
			reason: "check_overdue",
			validThrough: "2026-01-15",
			deadlineTimezone: "Europe/Berlin",
			expiresAt: "2026-01-15T23:00:00.000Z",
			lastSuccessfulAt: null,
			supportingCheckId: "check",
			restrictions: "",
		},
	],
	checks: [],
	events: [],
} as unknown as DrivingLicenceEmployeeRecord;

function renderMyLicence(intendedDriver: boolean) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<MyDrivingLicence
				record={record}
				employeeId="driver-employee"
				intendedDriver={intendedDriver}
			/>
		</QueryClientProvider>,
	);
}
afterEach(cleanup);

describe("My licence", () => {
	it("starts with each class's status, valid-through date and restrictions", async () => {
		renderMyLicence(true);
		const summary = screen.getByRole("region", { name: "Some driving classes are suspended" });
		const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
		expect(headings[0]).toBe("Some driving classes are suspended");
		const rows = within(summary).getAllByRole("row").slice(1);
		expect(
			rows.map((row) =>
				within(row)
					.getAllByRole("cell")
					.map((c) => c.textContent),
			),
		).toEqual([
			["B", "Authorized", "Jul 31, 2026 (Europe/Berlin)", "Corrective lenses"],
			["C", "Suspended", "Jan 15, 2026 (Europe/Berlin)", "—"],
		]);
		expect(screen.getByRole("heading", { name: "Original check evidence" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Unable to drive?" })).toBeTruthy();
		expect(await screen.findByRole("link", { name: "Download evidence PDF" })).toBeTruthy();
	});

	it("shows a former intended driver a read-only view with the evidence export", async () => {
		renderMyLicence(false);
		expect(
			screen.getByText(
				"You are no longer an intended driver. Your retained check records stay available to view and export.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Unable to drive?" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Report that I cannot drive" })).toBeNull();
		expect(await screen.findByRole("link", { name: "Download evidence PDF" })).toBeTruthy();
	});

	it("explains a person-wide suspension that a new check alone does not lift", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<MyDrivingLicence
					record={{
						...record,
						status: "suspended",
						personWideReason: "person_impediment",
						classes: [],
						authorizedClasses: [],
					}}
					employeeId="driver-employee"
					intendedDriver
				/>
			</QueryClientProvider>,
		);
		const summary = screen.getByRole("region", { name: "Driving authorization suspended" });
		expect(
			within(summary).getByText(
				"An impediment suspends driving in every class until a verifier reinstates it. A new check alone does not lift it.",
			),
		).toBeTruthy();
	});

	it("shows empty states before the first check", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<MyDrivingLicence
					record={{ ...record, status: "not_yet_checked", classes: [], authorizedClasses: [] }}
					employeeId="driver-employee"
					intendedDriver
				/>
			</QueryClientProvider>,
		);
		expect(
			screen.getByText("No class is authorized yet. A verifier records your first original check."),
		).toBeTruthy();
		expect(screen.getByText("No original check has been completed.")).toBeTruthy();
		expect(
			await screen.findByText("No checks or authorization decisions in this period."),
		).toBeTruthy();
	});
});
