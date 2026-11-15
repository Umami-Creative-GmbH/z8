// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportsContainer } from "@/components/reports/reports-container";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";
import type { ReportData } from "@/lib/reports/types";
import { useOrganizationSettings } from "@/stores/organization-settings-store";

const mocks = vi.hoisted(() => ({
	listeners: new Set<
		(value: {
			data: { user: { id: string }; session: { activeOrganizationId: string } };
		}) => void
	>(),
	generate: vi.fn(),
	pdf: vi.fn(),
	csv: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
	session: {
		data: {
			user: { id: "actor-a" },
			session: { activeOrganizationId: "org-a" },
		},
		isPending: false,
	},
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => mocks.session,
	authClient: {
		$store: {
			atoms: {
				session: {
					subscribe: (listener: (value: typeof mocks.session) => void) => {
						mocks.listeners.add(listener);
						return () => mocks.listeners.delete(listener);
					},
				},
			},
		},
	},
}));
vi.mock("@/app/[locale]/(app)/reports/actions", () => ({
	generateReport: mocks.generate,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_: string, fallback: string, values?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (all, key) =>
				String(values?.[key] ?? all),
			),
	}),
}));
vi.mock("sonner", () => ({
	toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en-US",
		timezone: "Europe/Berlin",
		timeFormat: "24h",
	}),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({
	useAppLocale: () => "en",
}));
vi.mock("@/components/closed-months/month-closure-strip", () => ({
	MonthClosureStrip: () => <p>Closure context</p>,
}));
vi.mock("@/hooks/use-report-employees", () => ({
	useReportEmployees: () => ({
		employees: [],
		isLoading: false,
		error: null,
		canViewMultiple: false,
	}),
}));
vi.mock("@/lib/reports/exporters/pdf-exporter", () => ({
	exportToPDF: mocks.pdf,
	generatePDFFilename: () => "fixture.pdf",
}));
vi.mock("@/lib/reports/exporters/csv-exporter", () => ({
	exportToCSV: mocks.csv,
	generateCSVFilename: () => "fixture.csv",
}));

const report: ReportData = {
	employee: {
		id: "employee-a",
		name: "Historic Ada",
		employeeNumber: "A-19",
		position: "Engineer",
		customFields: [
			{ fieldId: "po", name: "PO number", type: "text", value: "PN-7" },
		],
	},
	period: {
		startDate: "2026-09-01",
		endDate: "2026-09-30",
		label: "September 2026",
	},
	workHours: {
		totalHours: 16,
		totalMinutes: 960,
		workDays: 2,
		averagePerDay: 8,
		byMonth: new Map([["2026-09", { hours: 16, days: 2 }]]),
	},
	absences: {
		totalDays: 1,
		byCategory: new Map([["Vacation", { days: 1 }]]),
		vacation: { approved: 1, pending: 2 },
		sick: { approved: 0, pending: 0 },
		other: { approved: 0, pending: 0 },
		homeOffice: {
			days: 1,
			hoursWorked: 8,
			dateDetails: [{ date: "2026-09-10", hours: 8 }],
		},
	},
	complianceMetrics: {
		attendancePercentage: 100,
		overtimeMinutes: 0,
		underTimeMinutes: 0,
	},
};
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function view(mode: "visible" | "hidden" = "visible") {
	return (
		<Activity mode={mode}>
			<ReportsContainer
				currentEmployeeId="employee-a"
				organizationId="org-a"
				userId="actor-a"
			/>
		</Activity>
	);
}
async function generate() {
	await act(async () =>
		fireEvent.click(
			await screen.findByRole("button", { name: "Generate Report" }),
		),
	);
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.session = {
		data: {
			user: { id: "actor-a" },
			session: { activeOrganizationId: "org-a" },
		},
		isPending: false,
	};
	useOrganizationSettings.setState({
		isHydrated: true,
		timezone: "Europe/Berlin",
	});
	mocks.generate.mockResolvedValue({ success: true, data: report });
	mocks.pdf.mockResolvedValue("%PDF-fixture");
	mocks.csv.mockReturnValue("fixture");
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
	URL.createObjectURL = vi.fn(() => "blob:fixture");
	URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("employee report workspace", () => {
	it.each(["Activity", "replacement", "unmount", "batched account"])(
		"cancels an export on %s retirement and blocks duplicate pending downloads",
		async (retirement) => {
			const mounted = render(view());
			await generate();
			await screen.findByText("PN-7");
			const held = deferred<string>();
			mocks.pdf.mockReturnValueOnce(held.promise);
			const button = screen.getByRole("button", { name: "Export PDF" });
			await act(async () => {
				fireEvent.click(button);
				fireEvent.click(button);
			});
			expect(mocks.pdf).toHaveBeenCalledTimes(1);
			if (retirement === "Activity") {
				await act(async () => mounted.rerender(view("hidden")));
				await act(async () => mounted.rerender(view()));
			} else if (retirement === "replacement") {
				mocks.generate.mockResolvedValueOnce({
					success: true,
					data: {
						...report,
						employee: { ...report.employee, name: "Replacement Ada" },
					},
				});
				await generate();
				await screen.findByText("Replacement Ada");
			} else if (retirement === "unmount") mounted.unmount();
			else
				await act(async () => {
					for (const id of ["actor-b", "actor-a"])
						for (const listener of mocks.listeners)
							listener({ data: { ...mocks.session.data, user: { id } } });
				});
			const feedback = mocks.success.mock.calls.length;
			await act(async () => held.resolve("%PDF-retired"));
			expect(URL.createObjectURL).not.toHaveBeenCalled();
			expect(mocks.success).toHaveBeenCalledTimes(feedback);
		},
	);
	it("stages a period edit without replacing the applied preview or export scope", async () => {
		render(view());
		await generate();
		await screen.findByText("PN-7");
		fireEvent.click(screen.getByRole("combobox", { name: "Period" }));
		fireEvent.click(await screen.findByRole("option", { name: "Last Year" }));
		expect(mocks.generate).toHaveBeenCalledTimes(1);
		expect(screen.getByText("September 2026")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
		await waitFor(() =>
			expect(mocks.pdf).toHaveBeenCalledWith(
				report,
				expect.objectContaining({ timezone: "Europe/Berlin" }),
			),
		);
	});
	it("drops retained data on an authoritative refusal and offers Retry", async () => {
		render(view());
		await generate();
		await screen.findByText("PN-7");
		mocks.generate.mockResolvedValueOnce({
			success: false,
			code: "AuthorizationError",
			error: "Report access refused",
		});
		await generate();
		await screen.findByText("Report access refused");
		expect(screen.queryByText("PN-7")).toBeNull();
		expect(screen.queryByRole("button", { name: "Export PDF" })).toBeNull();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});
	it("prevents duplicate form commands and ignores a rejection after unmount", async () => {
		let reject!: (error: Error) => void;
		mocks.generate.mockReturnValueOnce(
			new Promise((_, fail) => {
				reject = fail;
			}),
		);
		const mounted = render(view());
		const button = await screen.findByRole("button", {
			name: "Generate Report",
		});
		await act(async () => {
			const form = button.closest("form");
			if (!form) throw new Error("Expected report form");
			fireEvent.submit(form);
			fireEvent.submit(form);
		});
		expect(mocks.generate).toHaveBeenCalledTimes(1);
		mounted.unmount();
		await act(async () => reject(new Error("Retired failure")));
		expect(mocks.error).not.toHaveBeenCalled();
	});
	it("observes batched identity signals before React renders A again", async () => {
		const held = deferred<{ success: true; data: ReportData }>();
		mocks.generate.mockReturnValueOnce(held.promise);
		render(view());
		await generate();
		await act(async () => {
			for (const id of ["org-b", "org-a"]) {
				const data = {
					...mocks.session.data,
					session: { activeOrganizationId: id },
				};
				for (const listener of mocks.listeners) listener({ data });
			}
			held.resolve({ success: true, data: report });
		});
		expect(mocks.success).not.toHaveBeenCalled();
		expect(screen.queryByText("PN-7")).toBeNull();
	});
	it("keeps the generated report visible while retrying a failed replacement", async () => {
		render(view());
		expect(screen.getByText("No report generated yet")).toBeTruthy();
		await generate();
		await screen.findAllByText("16h");
		const held = deferred<{ success: false; error: string }>();
		mocks.generate.mockReturnValueOnce(held.promise);
		await generate();
		expect(screen.getByText("PO number")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Export PDF" })).toHaveProperty(
			"disabled",
			true,
		);
		await act(async () =>
			held.resolve({ success: false, error: "Report source unavailable" }),
		);
		expect(screen.getByText("PN-7")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(3));
		expect(mocks.generate.mock.calls[2]).toEqual(mocks.generate.mock.calls[1]);
	});
	it.each(["organization", "account"])(
		"discards a held read across %s A → B → A",
		async (kind) => {
			const held = deferred<{ success: true; data: ReportData }>();
			mocks.generate.mockReturnValueOnce(held.promise);
			const mounted = render(view());
			await generate();
			if (kind === "organization")
				mocks.session.data.session.activeOrganizationId = "org-b";
			else mocks.session.data.user.id = "actor-b";
			mounted.rerender(view());
			if (kind === "organization")
				mocks.session.data.session.activeOrganizationId = "org-a";
			else mocks.session.data.user.id = "actor-a";
			mounted.rerender(view());
			await act(async () => held.resolve({ success: true, data: report }));
			expect(screen.queryByText("PN-7")).toBeNull();
			expect(mocks.success).not.toHaveBeenCalled();
			expect(
				screen.getByRole("button", { name: "Generate Report" }),
			).toHaveProperty("disabled", false);
		},
	);
	it("invalidates a held read on Activity hide and reconnects usable controls", async () => {
		const held = deferred<{ success: true; data: ReportData }>();
		mocks.generate.mockReturnValueOnce(held.promise);
		const mounted = render(view());
		await generate();
		await act(async () => mounted.rerender(view("hidden")));
		await act(async () => mounted.rerender(view()));
		await act(async () => held.resolve({ success: true, data: report }));
		expect(screen.queryByText("PN-7")).toBeNull();
		expect(mocks.success).not.toHaveBeenCalled();
		expect(
			screen.getByRole("button", { name: "Generate Report" }),
		).toHaveProperty("disabled", false);
	});
	it("suppresses held downloads after scope loss and does not replay them on return", async () => {
		const mounted = render(view());
		await generate();
		await screen.findByText("PN-7");
		const held = deferred<string>();
		mocks.pdf.mockReturnValueOnce(held.promise);
		fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
		mocks.session.data.session.activeOrganizationId = "org-b";
		mounted.rerender(view());
		mocks.session.data.session.activeOrganizationId = "org-a";
		mounted.rerender(view());
		await act(async () => held.resolve("%PDF-stale"));
		expect(URL.createObjectURL).not.toHaveBeenCalled();
		expect(mocks.success).toHaveBeenCalledTimes(1);
	});
	it("opts in only the exact report route while retaining independent descendants", () => {
		expect(appPageOwnsHeading("/de/reports")).toBe(true);
		expect(appPageOwnsHeading("/en/reports/vehicles")).toBe(false);
		expect(appPageOwnsHeading("/en/reports/unknown")).toBe(false);
	});
});
