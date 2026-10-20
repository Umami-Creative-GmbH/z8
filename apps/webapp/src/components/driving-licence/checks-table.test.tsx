// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/navigation", () => ({
	Link: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: "verifier" }, session: { activeOrganizationId: "org" } },
	}),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
			fallback.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? key)),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
const remote = vi.hoisted(() => ({
	rows: [] as unknown[],
	worklist: vi.fn(),
}));
vi.mock("@/lib/organization/driving-licence/check-actions", () => ({
	getDrivingLicenceCheckWorklistAction: async (query: unknown) => {
		remote.worklist(query);
		return { success: true, data: remote.rows };
	},
	getDrivingLicenceEmployeeRecordAction: async () => ({
		success: true,
		data: {
			enrolled: true,
			status: "not_yet_checked",
			authorizedClasses: [],
			classes: [],
			checks: [],
			events: [],
			timezone: "Europe/Berlin",
			uncertainEmailCount: 0,
		},
	}),
	completeDrivingLicenceCheckAction: vi.fn(),
}));
vi.mock("@/lib/organization/driving-licence/history-actions", () => ({
	getDrivingLicenceHistoryAction: async () => ({ success: false }),
	supplementDrivingLicenceCheckAction: vi.fn(),
}));
vi.mock("@/lib/organization/driving-licence/impediment-actions", () => ({
	getDrivingImpedimentStateAction: vi.fn(),
	reinstateDrivingAuthorizationAction: vi.fn(),
}));
const { DrivingLicenceVerifierWorklist } = await import("./check-worklist");

function row(
	name: string,
	status: string,
	extra: { team?: string; validThrough?: string; canVerify?: boolean } = {},
) {
	return {
		employeeId: name.toLowerCase().replace(" ", "-"),
		name,
		status,
		canVerify: extra.canVerify ?? true,
		enrolled: true,
		authorizedClasses: [],
		classes: [],
		timezone: "Europe/Berlin",
		team: extra.team ? { id: `team-${extra.team}`, name: extra.team } : null,
		nextDeadline: extra.validThrough
			? {
					validThrough: extra.validThrough,
					timezone: "Europe/Berlin",
					expiresAt: `${extra.validThrough}T22:00:00.000Z`,
				}
			: null,
	};
}
function renderWorklist() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<DrivingLicenceVerifierWorklist />
		</QueryClientProvider>,
	);
}
beforeEach(() => {
	remote.rows = [
		row("Carla Unchecked", "not_yet_checked"),
		row("Bruno Soon", "active", { team: "North", validThrough: "2026-02-10" }),
		row("Anna Later", "partially_active", { validThrough: "2026-05-01" }),
	];
});
afterEach(() => {
	cleanup();
	remote.worklist.mockReset();
});

describe("the verifier's Checks table", () => {
	it("lists the server's rows in its order, with status, next deadline and team", async () => {
		renderWorklist();
		const table = await screen.findByRole("table");
		const rows = within(table).getAllByRole("row").slice(1);
		expect(rows.map((entry) => within(entry).getAllByRole("cell")[0].textContent)).toEqual([
			"Carla Unchecked",
			"Bruno Soon",
			"Anna Later",
		]);
		const bruno = within(rows[1]).getAllByRole("cell");
		expect(bruno[1].textContent).toBe("Active");
		expect(bruno[2].textContent).toBe("Feb 10, 2026 (Europe/Berlin)");
		expect(bruno[3].textContent).toBe("North");
		const carla = within(rows[0]).getAllByRole("cell");
		expect(carla[1].textContent).toBe("Not yet checked");
		expect(carla[2].textContent).toBe("Check due now");
		expect(within(rows[2]).getAllByRole("cell")[1].textContent).toBe("Partially active");
		expect(remote.worklist).toHaveBeenCalledWith({ search: "", status: undefined });
	});

	it("asks the server to search by name", async () => {
		const user = userEvent.setup();
		renderWorklist();
		await screen.findByRole("table");
		await user.type(screen.getByRole("searchbox", { name: "Search by name" }), "bru");
		await waitFor(() =>
			expect(remote.worklist).toHaveBeenLastCalledWith({ search: "bru", status: undefined }),
		);
	});

	it("asks the server to filter by status", async () => {
		const user = userEvent.setup();
		renderWorklist();
		await screen.findByRole("table");
		await user.click(screen.getByRole("combobox", { name: "Status" }));
		await user.click(await screen.findByRole("option", { name: "Suspended" }));
		await waitFor(() =>
			expect(remote.worklist).toHaveBeenLastCalledWith({ search: "", status: "suspended" }),
		);
	});

	it("sorts by soonest deadline by default and asks the server to sort by another column", async () => {
		const user = userEvent.setup();
		renderWorklist();
		const table = await screen.findByRole("table");
		const header = (name: string) =>
			within(table)
				.getByRole("button", { name: new RegExp(`^${name}`) })
				.closest("th");
		expect(header("Next deadline")?.getAttribute("aria-sort")).toBe("ascending");
		expect(header("Name")?.getAttribute("aria-sort")).toBe("none");

		await user.click(within(table).getByRole("button", { name: /^Name/ }));
		await waitFor(() =>
			expect(remote.worklist).toHaveBeenLastCalledWith({
				search: "",
				status: undefined,
				sort: "name",
				direction: "asc",
			}),
		);
		expect(header("Name")?.getAttribute("aria-sort")).toBe("ascending");
		await user.click(within(table).getByRole("button", { name: /^Name/ }));
		await waitFor(() =>
			expect(remote.worklist).toHaveBeenLastCalledWith({
				search: "",
				status: undefined,
				sort: "name",
				direction: "desc",
			}),
		);
		await user.click(within(table).getByRole("button", { name: /^Team/ }));
		await waitFor(() =>
			expect(remote.worklist).toHaveBeenLastCalledWith({
				search: "",
				status: undefined,
				sort: "team",
				direction: "asc",
			}),
		);
	});

	it("explains an empty scope", async () => {
		remote.rows = [];
		renderWorklist();
		expect(await screen.findByText("Nobody to check yet")).toBeTruthy();
		expect(screen.queryByRole("table")).toBeNull();
	});

	it("says when no intended driver matches the search", async () => {
		const user = userEvent.setup();
		renderWorklist();
		await screen.findByRole("table");
		remote.rows = [];
		await user.type(screen.getByRole("searchbox", { name: "Search by name" }), "zz");
		expect(await screen.findByText("No intended drivers match the search or filter.")).toBeTruthy();
		expect(screen.queryByText("Nobody to check yet")).toBeNull();
	});

	it("links each row to that employee's check page (#1429)", async () => {
		remote.rows = [
			row("Bruno Soon", "active", { validThrough: "2026-02-10" }),
			row("Fiona Former", "ended", { canVerify: false }),
		];
		renderWorklist();
		expect(
			(await screen.findByRole("link", { name: "Check Bruno Soon" })).getAttribute("href"),
		).toBe("/driving-licence/checks/bruno-soon");
		expect(
			screen.getByRole("link", { name: "View ended record for Fiona Former" }).getAttribute("href"),
		).toBe("/driving-licence/checks/fiona-former");
		expect(screen.queryByRole("heading", { name: /original licence/ })).toBeNull();
	});
});
