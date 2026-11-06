/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { render } from "@/test/render-with-translations";
import type {
	OrgExplorerData,
	OrgExplorerPerson,
	OrgExplorerTeam,
} from "./org-explorer-types";

const mocks = vi.hoisted(() => ({
	search: vi.fn(),
	people: vi.fn(),
	teamMembers: vi.fn(),
	group: vi.fn(),
	data: vi.fn(),
	setCenter: vi.fn(),
	fitView: vi.fn(),
	isMobile: false,
}));

vi.mock("./actions", () => ({
	searchOrgEmployees: mocks.search,
	getOrgExplorerPeople: mocks.people,
	getOrgExplorerTeamMembers: mocks.teamMembers,
	getOrgExplorerGroup: mocks.group,
	getOrgExplorerData: mocks.data,
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mocks.isMobile }));

vi.mock("@/components/providers/view-refresh-provider", () => ({
	useViewRefresh: () => {},
}));

vi.mock("@/navigation", () => ({
	Link: ({
		href,
		children,
		...props
	}: {
		href: string;
		children: ReactNode;
	}) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: () => <span aria-hidden="true" />,
}));

// Next keeps useSearchParams in step with history.pushState; this stands in for it.
const locationListeners = new Set<() => void>();
function subscribeToLocation(listener: () => void) {
	locationListeners.add(listener);
	window.addEventListener("popstate", listener);
	return () => {
		locationListeners.delete(listener);
		window.removeEventListener("popstate", listener);
	};
}

vi.mock("next/navigation", () => ({
	useSearchParams: () => {
		const search = useSyncExternalStore(
			subscribeToLocation,
			() => window.location.search,
		);
		return useMemo(() => new URLSearchParams(search), [search]);
	},
}));

vi.mock("@xyflow/react", () => ({
	Background: () => null,
	Controls: () => null,
	Handle: () => null,
	Position: { Bottom: "bottom", Top: "top" },
	ReactFlow: ({
		nodes,
		edges,
		nodeTypes,
	}: {
		nodes: Array<{
			id: string;
			type: string;
			data: unknown;
			position: { x: number; y: number };
		}>;
		edges: Array<{ source: string; target: string }>;
		nodeTypes: Record<string, (props: { data: unknown }) => ReactNode>;
	}) => (
		<div data-testid="react-flow">
			<div data-testid="flow-edges">
				{JSON.stringify(edges.map((edge) => [edge.source, edge.target]))}
			</div>
			{nodes.map((node) => {
				const NodeComponent = nodeTypes[node.type];
				return NodeComponent ? (
					<div data-node-y={node.position.y} key={node.id}>
						<NodeComponent data={node.data} />
					</div>
				) : null;
			})}
		</div>
	),
	ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
	useReactFlow: () => ({ setCenter: mocks.setCenter, fitView: mocks.fitView }),
}));

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	HTMLElement.prototype.scrollIntoView = vi.fn();
	const pushState = window.history.pushState.bind(window.history);
	window.history.pushState = (...args: Parameters<History["pushState"]>) => {
		pushState(...args);
		for (const listener of locationListeners) listener();
	};
});

function person(
	employeeId: string,
	overrides: Partial<OrgExplorerPerson> = {},
): OrgExplorerPerson {
	return {
		employeeId,
		userId: `user-${employeeId}`,
		name: employeeId,
		pronouns: null,
		email: `${employeeId}@example.com`,
		image: null,
		position: null,
		primaryTeamId: overrides.teamIds?.[0] ?? null,
		teamIds: [],
		managerIds: [],
		primaryManagerId: overrides.managerIds?.[0] ?? null,
		reportIds: [],
		lineReportIds: [],
		...overrides,
	};
}

const teams: OrgExplorerTeam[] = [
	{
		teamId: "ops",
		name: "Ops",
		description: "Keeps things running",
		leadEmployeeId: "ceo",
		memberCount: 3,
	},
	{
		teamId: "sales",
		name: "Sales",
		description: null,
		leadEmployeeId: "ada",
		memberCount: 2,
	},
	{
		teamId: "hr",
		name: "Hr",
		description: null,
		leadEmployeeId: null,
		memberCount: 1,
	},
];

const people: OrgExplorerPerson[] = [
	person("ceo", {
		name: "Cora Ceo",
		position: "Chief executive",
		reportIds: ["vp", "ada"],
		lineReportIds: ["vp"],
	}),
	person("vp", {
		name: "Vic Vp",
		managerIds: ["ceo"],
		reportIds: ["ada", "bob"],
		lineReportIds: ["ada", "bob"],
		teamIds: ["ops"],
	}),
	person("ada", {
		name: "Ada Analyst",
		position: "Analyst",
		email: "ada@example.com",
		managerIds: ["vp", "ceo"],
		reportIds: ["deb"],
		lineReportIds: ["deb"],
		teamIds: ["sales", "ops"],
	}),
	person("bob", {
		name: "Bob Builder",
		managerIds: ["vp"],
		teamIds: ["ops", "hr", "sales"],
	}),
	person("deb", { name: "Deb Dev", managerIds: ["ada"] }),
	person("lou", { name: "Lou Loner" }),
];

const data: OrgExplorerData = {
	complete: true,
	employeeCount: people.length,
	viewerEmployeeId: "ada",
	teams,
	people,
	rootIds: ["ceo"],
	noReportingLineCount: 1,
	noTeamCount: 3,
};

async function renderExplorer(
	options: {
		initialData?: OrgExplorerData;
		canManage?: boolean;
		search?: string;
	} = {},
) {
	window.history.replaceState(null, "", `/organization${options.search ?? ""}`);
	const { OrgExplorerClient } = await import("./org-explorer-client");
	return render(
		<OrgExplorerClient
			canManage={options.canManage ?? false}
			initialData={options.initialData ?? data}
		/>,
	);
}

function card(employeeId: string) {
	return screen.getByTestId(`org-person-${employeeId}`);
}

function edges() {
	return JSON.parse(
		screen.getByTestId("flow-edges").textContent ?? "[]",
	) as string[][];
}

function query() {
	return new URLSearchParams(window.location.search);
}

beforeEach(() => {
	for (const mock of [
		mocks.search,
		mocks.people,
		mocks.teamMembers,
		mocks.group,
		mocks.data,
	]) {
		mock.mockReset();
	}
	mocks.setCenter.mockReset();
	mocks.fitView.mockReset();
	mocks.isMobile = false;
});

afterEach(() => {
	window.history.replaceState(null, "", "/organization");
});

describe("OrgExplorerClient", () => {
	it("shows an empty state when nobody is on the roster", async () => {
		await renderExplorer({
			initialData: { ...data, people: [], rootIds: [], employeeCount: 0 },
		});

		expect(screen.getByText("No current employees found")).toBeTruthy();
	});

	describe("views", () => {
		it("shows Reporting lines by default and switches to Teams through the control", async () => {
			await renderExplorer();

			expect(
				screen
					.getByRole("radio", { name: "Reporting lines" })
					.getAttribute("aria-checked"),
			).toBe("true");
			expect(screen.getByTestId("react-flow")).toBeTruthy();

			fireEvent.click(screen.getByRole("radio", { name: "Teams" }));

			expect(query().get("view")).toBe("teams");
			expect(screen.queryByTestId("react-flow")).toBeNull();
			expect(screen.getByRole("heading", { name: "No team" })).toBeTruthy();
		});

		it("opens the view named in ?view= and follows the back button", async () => {
			await renderExplorer({ search: "?view=teams" });

			expect(
				screen
					.getByRole("radio", { name: "Teams" })
					.getAttribute("aria-checked"),
			).toBe("true");

			act(() => {
				window.history.pushState(null, "", "/organization");
			});

			expect(screen.getByTestId("react-flow")).toBeTruthy();
		});
	});

	describe("Reporting lines", () => {
		it("draws one line per person, from their primary manager, and no team lines", async () => {
			await renderExplorer();

			expect(edges()).toEqual([
				["ceo", "vp"],
				["vp", "ada"],
				["vp", "bob"],
			]);
			expect(screen.queryByText("Keeps things running")).toBeNull();
		});

		it("marks people with more managers and places managers above their reports", async () => {
			await renderExplorer();

			expect(within(card("ada")).getByText("+1 manager")).toBeTruthy();
			expect(within(card("bob")).queryByText(/manager/)).toBeNull();
			const y = (id: string) =>
				Number(card(id).parentElement?.getAttribute("data-node-y"));
			expect(y("ceo")).toBeLessThan(y("vp"));
			expect(y("vp")).toBeLessThan(y("ada"));
		});

		it("shows team chips with the primary team first and +N for the rest", async () => {
			await renderExplorer();

			expect(
				within(card("ada"))
					.getAllByTestId("team-chip")
					.map((chip) => chip.textContent),
			).toEqual(["Sales", "Ops"]);
			expect(
				within(card("bob"))
					.getAllByTestId("team-chip")
					.map((chip) => chip.textContent),
			).toEqual(["Ops", "Hr", "+1"]);
		});

		it("opens two levels by default and toggles a subtree from the direct-report count", async () => {
			await renderExplorer();

			expect(screen.queryByTestId("org-person-deb")).toBeNull();
			const adaReports = within(card("ada")).getByRole("button", {
				name: "1 direct report",
			});
			expect(adaReports.getAttribute("aria-expanded")).toBe("false");

			fireEvent.click(adaReports);
			expect(card("deb")).toBeTruthy();
			expect(adaReports.getAttribute("aria-expanded")).toBe("true");

			fireEvent.click(
				within(card("vp")).getByRole("button", { name: "2 direct reports" }),
			);
			expect(screen.queryByTestId("org-person-ada")).toBeNull();
			expect(screen.queryByTestId("org-person-deb")).toBeNull();
		});

		it("lists people with no manager and no reports under No reporting line, not on top", async () => {
			await renderExplorer();
			const group = screen.getByRole("region", { name: "No reporting line" });

			expect(
				within(group).getByRole("button", { name: /Lou Loner/ }),
			).toBeTruthy();
			expect(screen.queryByTestId("org-person-lou")).toBeNull();
		});

		it("highlights the filtered teams' members, dims the rest and keeps their path visible", async () => {
			await renderExplorer({ search: "?team=sales" });

			expect(card("ada").getAttribute("data-highlight")).toBe("match");
			expect(card("bob").getAttribute("data-highlight")).toBe("match");
			expect(card("vp").getAttribute("data-highlight")).toBe("path");
			expect(card("ceo").getAttribute("data-highlight")).toBe("path");
		});

		it("dims people outside the filtered teams and their paths", async () => {
			await renderExplorer({ search: "?team=hr" });

			expect(card("bob").getAttribute("data-highlight")).toBe("match");
			expect(card("ada").getAttribute("data-highlight")).toBe("dimmed");
		});
	});

	describe("team filter", () => {
		it("writes the chosen teams to the URL", async () => {
			await renderExplorer();

			fireEvent.click(screen.getByRole("button", { name: /Filter by team/ }));
			fireEvent.click(await screen.findByRole("option", { name: /Ops/ }));
			fireEvent.click(await screen.findByRole("option", { name: /Hr/ }));

			expect(query().getAll("team")).toEqual(["ops", "hr"]);
		});

		it("narrows the Teams grid", async () => {
			await renderExplorer({ search: "?view=teams&team=hr" });

			expect(
				screen
					.getAllByTestId(/^team-card-/)
					.map((entry) => entry.getAttribute("data-team")),
			).toEqual(["hr"]);
			expect(screen.queryByRole("heading", { name: "No team" })).toBeNull();
		});
	});

	describe("Teams", () => {
		it("shows each team's lead, members and count, with multi-team members on each card", async () => {
			await renderExplorer({ search: "?view=teams" });
			const ops = screen.getByTestId("team-card-ops");
			const sales = screen.getByTestId("team-card-sales");

			expect(within(ops).getByText("Keeps things running")).toBeTruthy();
			expect(
				within(within(ops).getByTestId("team-lead")).getByText("Cora Ceo"),
			).toBeTruthy();
			expect(within(ops).getByText("3 members")).toBeTruthy();
			expect(
				within(within(ops).getByRole("list"))
					.getAllByRole("listitem")
					.map((item) => item.textContent),
			).toEqual([
				"Ada AnalystAnalyst",
				"Bob BuilderPrimary team",
				"Vic VpPrimary team",
			]);
			expect(
				within(sales).getByText("Ada Analyst", {
					selector: "[data-testid=team-lead] *",
				}),
			).toBeTruthy();
			expect(
				within(within(sales).getByRole("list")).getAllByRole("listitem"),
			).toHaveLength(2);
		});

		it("collects people without a team membership on a No team card", async () => {
			await renderExplorer({ search: "?view=teams" });
			const noTeam = screen.getByTestId("team-card-none");

			expect(
				within(within(noTeam).getByRole("list"))
					.getAllByRole("listitem")
					.map((item) => item.textContent),
			).toEqual(["Cora CeoChief executive", "Deb Dev", "Lou Loner"]);
		});

		it("opens the detail panel for a member", async () => {
			await renderExplorer({ search: "?view=teams" });

			fireEvent.click(
				within(screen.getByTestId("team-card-hr")).getByRole("button", {
					name: /Bob Builder/,
				}),
			);

			expect(query().get("employee")).toBe("bob");
			expect(
				within(await screen.findByRole("dialog")).getByRole("heading", {
					name: "Bob Builder",
				}),
			).toBeTruthy();
		});
	});

	describe("detail panel", () => {
		it("shows managers, direct reports, team memberships and email for the clicked person", async () => {
			await renderExplorer();

			fireEvent.click(
				within(card("ada")).getByRole("button", { name: /Ada Analyst/ }),
			);
			const panel = await screen.findByRole("dialog");

			expect(query().get("employee")).toBe("ada");
			expect(
				within(panel).getByRole("heading", { name: "Ada Analyst" }),
			).toBeTruthy();
			expect(within(panel).getByText("Analyst")).toBeTruthy();
			expect(
				within(within(panel).getByRole("region", { name: "Managers" }))
					.getAllByRole("listitem")
					.map((item) => item.textContent),
			).toEqual(["Vic VpPrimary manager", "Cora CeoChief executive"]);
			expect(
				within(within(panel).getByRole("region", { name: "Direct reports" }))
					.getAllByRole("listitem")
					.map((item) => item.textContent),
			).toEqual(["Deb Dev"]);
			expect(
				within(within(panel).getByRole("region", { name: "Team memberships" }))
					.getAllByRole("listitem")
					.map((item) => item.textContent),
			).toEqual(["SalesPrimary team", "Ops"]);
			expect(
				within(panel)
					.getByRole("link", { name: "ada@example.com" })
					.getAttribute("href"),
			).toBe("mailto:ada@example.com");
			expect(
				within(panel).queryByRole("link", { name: "Edit employee" }),
			).toBeNull();
		});

		it("marks no primary manager when the reporting line falls back to another manager", async () => {
			await renderExplorer({
				initialData: {
					...data,
					people: people.map((entry) =>
						entry.employeeId === "ada"
							? { ...entry, primaryManagerId: null }
							: entry,
					),
				},
				search: "?employee=ada",
			});
			const panel = await screen.findByRole("dialog");

			expect(
				within(within(panel).getByRole("region", { name: "Managers" }))
					.getAllByRole("listitem")
					.map((item) => item.textContent),
			).toEqual(["Vic Vp", "Cora CeoChief executive"]);
		});

		it("gives admins links to edit the employee and manage each of their teams", async () => {
			await renderExplorer({ canManage: true, search: "?employee=ada" });
			const panel = await screen.findByRole("dialog");
			const memberships = within(panel).getByRole("region", {
				name: "Team memberships",
			});

			expect(
				within(panel)
					.getByRole("link", { name: "Edit employee" })
					.getAttribute("href"),
			).toBe("/settings/employees/ada");
			expect(
				within(memberships)
					.getAllByRole("link")
					.map((link) => link.getAttribute("href")),
			).toEqual(["/settings/teams/sales", "/settings/teams/ops"]);
			expect(
				within(panel).queryByRole("link", { name: "Manage teams" }),
			).toBeNull();
		});

		it("gives admins a link to the teams for someone without a team", async () => {
			await renderExplorer({ canManage: true, search: "?employee=lou" });
			const panel = await screen.findByRole("dialog");

			expect(
				within(panel)
					.getByRole("link", { name: "Manage teams" })
					.getAttribute("href"),
			).toBe("/settings/teams");
		});

		it("does not link the teams for other viewers", async () => {
			await renderExplorer({ search: "?employee=ada" });
			const panel = await screen.findByRole("dialog");

			expect(
				within(
					within(panel).getByRole("region", { name: "Team memberships" }),
				).queryAllByRole("link"),
			).toEqual([]);
		});

		it("opens from ?employee= and jumps to a manager, opening the path to them", async () => {
			await renderExplorer({ search: "?employee=deb" });
			const panel = await screen.findByRole("dialog");

			expect(
				within(panel).getByRole("heading", { name: "Deb Dev" }),
			).toBeTruthy();
			expect(card("deb")).toBeTruthy();

			fireEvent.click(
				within(panel).getByRole("button", { name: /Ada Analyst/ }),
			);

			expect(query().get("employee")).toBe("ada");
			expect(
				within(await screen.findByRole("dialog")).getByRole("heading", {
					name: "Ada Analyst",
				}),
			).toBeTruthy();
		});
	});

	describe("search", () => {
		it("opens the path to the chosen person, centres on them and selects them", async () => {
			mocks.search.mockResolvedValueOnce({
				success: true,
				data: [
					{
						employeeId: "deb",
						name: "Deb Dev",
						pronouns: null,
						email: "deb@example.com",
						position: null,
						image: null,
					},
				],
			});
			await renderExplorer();

			fireEvent.change(screen.getByLabelText("Search employees"), {
				target: { value: "Deb" },
			});
			fireEvent.click(
				await screen.findByRole("button", { name: "Deb Dev deb@example.com" }),
			);

			expect(query().get("employee")).toBe("deb");
			expect(card("deb")).toBeTruthy();
			await waitFor(() => expect(mocks.setCenter).toHaveBeenCalled());
			expect(mocks.search).toHaveBeenCalledWith("Deb");
			expect(mocks.people).not.toHaveBeenCalled();
		});

		it("ignores a stale search response", async () => {
			let resolveFirst: (value: unknown) => void = () => {};
			mocks.search
				.mockImplementationOnce(
					() => new Promise((resolve) => (resolveFirst = resolve)),
				)
				.mockResolvedValueOnce({ success: true, data: [] });
			await renderExplorer();
			const input = screen.getByLabelText("Search employees");

			fireEvent.change(input, { target: { value: "Ad" } });
			fireEvent.change(input, { target: { value: "Adz" } });
			expect(await screen.findByText("No employees found")).toBeTruthy();
			await act(async () => {
				resolveFirst({
					success: true,
					data: [
						{
							employeeId: "ada",
							name: "Ada Analyst",
							pronouns: null,
							email: "a",
							position: null,
							image: null,
						},
					],
				});
			});

			expect(
				screen.queryByRole("button", { name: "Ada Analyst a" }),
			).toBeNull();
		});
	});

	describe("on phones", () => {
		it("shows Reporting lines as an outline and the panel as a bottom sheet", async () => {
			mocks.isMobile = true;
			await renderExplorer();

			expect(screen.queryByTestId("react-flow")).toBeNull();
			const outline = screen.getByRole("list", { name: "Reporting lines" });
			const cora = within(outline).getByRole("listitem", { name: "Cora Ceo" });
			expect(
				within(cora)
					.getAllByRole("button", { name: "1 direct report" })[0]
					?.getAttribute("aria-expanded"),
			).toBe("true");
			expect(within(outline).queryByText("Deb Dev")).toBeNull();

			fireEvent.click(
				within(outline).getByRole("button", { name: /Ada Analyst/ }),
			);

			const panel = await screen.findByRole("dialog");
			expect(panel.getAttribute("data-sheet-side")).toBe("bottom");
		});

		it("collapses and expands a subtree in the outline", async () => {
			mocks.isMobile = true;
			await renderExplorer();
			const outline = screen.getByRole("list", { name: "Reporting lines" });

			const ada = within(outline).getByRole("listitem", {
				name: "Ada Analyst",
			});
			const toggle = within(ada).getByRole("button", {
				name: "1 direct report",
			});
			fireEvent.click(toggle);
			expect(within(outline).getByText("Deb Dev")).toBeTruthy();

			fireEvent.click(toggle);
			expect(within(outline).queryByText("Deb Dev")).toBeNull();
		});
	});

	describe("a large organization", () => {
		const partial: OrgExplorerData = {
			...data,
			complete: false,
			employeeCount: 500,
			people: people.filter(
				(entry) => entry.employeeId !== "deb" && entry.employeeId !== "lou",
			),
			noReportingLineCount: 40,
			noTeamCount: 120,
		};

		it("loads a subtree on demand when it is expanded", async () => {
			mocks.people.mockResolvedValueOnce({ success: true, data: [people[4]] });
			await renderExplorer({ initialData: partial });

			fireEvent.click(
				within(card("ada")).getByRole("button", { name: "1 direct report" }),
			);

			expect(mocks.people).toHaveBeenCalledWith(["deb"]);
			expect(await screen.findByTestId("org-person-deb")).toBeTruthy();
		});

		it("loads the path to a person chosen in search", async () => {
			mocks.search.mockResolvedValueOnce({
				success: true,
				data: [
					{
						employeeId: "deb",
						name: "Deb Dev",
						pronouns: null,
						email: "d",
						position: null,
						image: null,
					},
				],
			});
			mocks.people.mockResolvedValue({ success: true, data: [people[4]] });
			await renderExplorer({ initialData: partial });

			fireEvent.change(screen.getByLabelText("Search employees"), {
				target: { value: "Deb" },
			});
			fireEvent.click(await screen.findByRole("button", { name: "Deb Dev d" }));

			await waitFor(() =>
				expect(mocks.people).toHaveBeenCalledWith(["deb"], { withPaths: true }),
			);
			expect(await screen.findByTestId("org-person-deb")).toBeTruthy();
		});

		it("loads the people without a reporting line on request, a page at a time", async () => {
			mocks.group
				.mockResolvedValueOnce({
					success: true,
					data: { people: [people[5]], nextOffset: 1 },
				})
				.mockResolvedValueOnce({
					success: true,
					data: {
						people: [person("zed", { name: "Zed Zero" })],
						nextOffset: null,
					},
				});
			await renderExplorer({
				initialData: { ...partial, noReportingLineCount: 2 },
			});
			const group = screen.getByRole("region", { name: "No reporting line" });

			fireEvent.click(
				within(group).getByRole("button", { name: "Show 2 people" }),
			);

			expect(mocks.group).toHaveBeenCalledWith("noReportingLine", 0);
			expect(
				await within(group).findByRole("button", { name: /Lou Loner/ }),
			).toBeTruthy();

			fireEvent.click(
				within(group).getByRole("button", { name: "Show 1 person" }),
			);

			expect(mocks.group).toHaveBeenLastCalledWith("noReportingLine", 1);
			expect(
				await within(group).findByRole("button", { name: /Zed Zero/ }),
			).toBeTruthy();
			expect(within(group).queryByRole("button", { name: /^Show/ })).toBeNull();
		});

		it("loads the filtered teams' members, a team at a time", async () => {
			mocks.teamMembers.mockResolvedValue({
				success: true,
				data: { people: [people[4]], nextOffset: null },
			});
			await renderExplorer({
				initialData: partial,
				search: "?team=hr&team=ops",
			});

			await waitFor(() => {
				expect(mocks.teamMembers).toHaveBeenCalledWith("hr", 0);
				expect(mocks.teamMembers).toHaveBeenCalledWith("ops", 0);
			});
		});

		it("loads a team's members on request in the Teams view until all are loaded", async () => {
			mocks.teamMembers
				.mockResolvedValueOnce({
					success: true,
					data: {
						people: [person("hal", { name: "Hal Hr", teamIds: ["hr"] })],
						nextOffset: 1,
					},
				})
				.mockResolvedValueOnce({
					success: true,
					data: {
						people: [person("hen", { name: "Hen Hr", teamIds: ["hr"] })],
						nextOffset: null,
					},
				});
			await renderExplorer({
				initialData: {
					...partial,
					teams: [{ ...teams[2], memberCount: 3 } as OrgExplorerTeam],
				},
				search: "?view=teams",
			});
			const hr = screen.getByTestId("team-card-hr");

			fireEvent.click(
				within(hr).getByRole("button", { name: "Show 2 people" }),
			);

			expect(mocks.teamMembers).toHaveBeenCalledWith("hr", 0);
			expect(
				await within(hr).findByRole("button", { name: /Hal Hr/ }),
			).toBeTruthy();

			fireEvent.click(
				within(hr).getByRole("button", { name: "Show 1 person" }),
			);

			expect(mocks.teamMembers).toHaveBeenLastCalledWith("hr", 1);
			expect(
				await within(hr).findByRole("button", { name: /Hen Hr/ }),
			).toBeTruthy();
			expect(within(hr).queryByRole("button", { name: /^Show/ })).toBeNull();
		});
	});
});
