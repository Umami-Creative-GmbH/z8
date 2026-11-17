/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DateTime } from "luxon";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTodayBriefing } from "@/app/[locale]/(app)/today/actions";
import TodayPage from "@/app/[locale]/(app)/today/page";
import {
	OrganizationContextProvider,
	useOrganization,
} from "@/components/providers/organization-context-provider";
import {
	useViewRefreshAction,
	ViewRefreshProvider,
} from "@/components/providers/view-refresh-provider";
import type { OrganizationDisplayContext } from "@/lib/auth/organization-display-context";
import {
	getManagerDailyBriefingFromSources,
	type ManagerDailyBriefingSources,
} from "@/lib/manager-daily-briefing/get-manager-daily-briefing";

const h = vi.hoisted(() => ({
	employee: vi.fn(),
	build: vi.fn(),
	sources: [] as unknown[],
	router: { refresh: vi.fn(), replace: vi.fn() },
	session: {
		data: {
			user: { id: "provenance-user" },
			session: { id: "provenance-session", activeOrganizationId: "provenance-org" },
		},
		isPending: false,
	},
}));
// External public employee action and data adapter seams only. Today page,
// readTodayBriefing, provider, controller, briefing and builder remain production.
vi.mock("@/app/[locale]/(app)/team/actions", () => ({ getCurrentEmployee: h.employee }));
vi.mock("@/lib/manager-daily-briefing/get-manager-daily-briefing", async (original) => ({
	...(await original<typeof import("@/lib/manager-daily-briefing/get-manager-daily-briefing")>()),
	getManagerDailyBriefing: h.build,
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => h.session }));
vi.mock("next/navigation", () => ({ useRouter: () => h.router }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: (p: string) => {
		throw Error(`redirect:${p}`);
	},
}));
vi.mock("@/navigation", () => ({
	useRouter: () => h.router,
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@/tolgee/server", () => ({ getTranslate: async () => (_k: string, f: string) => f }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_k: string, f: string, p: Record<string, string | number> = {}) =>
			Object.entries(p).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), f),
	}),
}));
function employee(role = "manager") {
	return {
		id: "provenance-employee",
		userId: "provenance-user",
		organizationId: "provenance-org",
		role,
	};
}
function context(role: "manager" | "admin" = "manager"): OrganizationDisplayContext {
	return {
		userId: "provenance-user",
		organizationId: "provenance-org",
		employee: { employeeId: "provenance-employee", organizationId: "provenance-org", role },
		organizationSettings: null,
		updatedAt: Date.now(),
	};
}
async function build({ currentEmployee }: { currentEmployee: ReturnType<typeof employee> }) {
	const sources: ManagerDailyBriefingSources = {
		getScopedEmployees: async (input) => {
			h.sources.push({ kind: "population", ...input });
			return (
				input.role === "admin" ? ["managed-report", "outside-report"] : ["managed-report"]
			).map((id) => ({ id, name: id, teamName: null }));
		},
		getApprovals: async (input) => {
			h.sources.push({ kind: "approvals", ...input });
			return ["managed-report", "outside-report"].map((id) => ({
				id: `approval-${id}`,
				approvalType: "absence",
				entityId: `leave-${id}`,
				typeName: "Leave",
				requester: { id, name: id },
				priority: "normal",
				display: { summary: `${id} private reason` },
			}));
		},
		getPublishedShifts: async () => [],
		getOpenTimeRecords: async () => [],
		getApprovedAbsences: async () => [],
		getCoverageRules: async () => [],
		getOvertimeWarnings: async () => [],
		getPayrollIssues: async () => [],
		getDrivingDetailsMissingCount: async () => 0,
	};
	return getManagerDailyBriefingFromSources({
		organizationId: currentEmployee.organizationId,
		currentEmployee,
		now: DateTime.fromISO("2026-11-17T12:00:00Z"),
		timezone: "Europe/Berlin",
		sources,
	});
}
function Inspect() {
	const o = useOrganization();
	const refresh = useViewRefreshAction();
	return (
		<>
			<output data-testid="published">
				{JSON.stringify([o.userId, o.activeOrganizationId, o.employeeId, o.role])}
			</output>
			<button type="button" onClick={refresh.refresh}>
				Refresh briefing control
			</button>
		</>
	);
}
let client: QueryClient;
async function page() {
	const shell = TodayPage();
	const serverContent = shell.props.children;
	return serverContent.type(serverContent.props);
}
function mount(element: ReactNode, role: "manager" | "admin" = "manager") {
	client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	return render(
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={context(role)}>
				<ViewRefreshProvider>
					<Inspect />
					{element}
				</ViewRefreshProvider>
			</OrganizationContextProvider>
		</QueryClientProvider>,
	);
}
beforeEach(() => {
	vi.clearAllMocks();
	h.sources = [];
	h.employee.mockResolvedValue(employee());
	h.build.mockImplementation(build);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			if (url !== "/api/auth/context") throw Error("Unexpected transport");
			return new Response(
				JSON.stringify({
					user: { id: "provenance-user" },
					session: { activeOrganizationId: "provenance-org" },
					employee: context().employee,
					organizationSettings: null,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}),
	);
});
afterEach(() => {
	cleanup();
	client?.clear();
	vi.unstubAllGlobals();
});
describe("Today producer provenance", () => {
	it("control: matching canonical manager page and read filter oversupplied private rows", async () => {
		mount(await page());
		expect(h.employee).toHaveBeenCalledTimes(2);
		expect(screen.getByText("managed-report private reason")).toBeTruthy();
		expect(screen.queryByText("outside-report private reason")).toBeNull();
		expect(h.sources).toContainEqual({
			kind: "population",
			organizationId: "provenance-org",
			currentEmployeeId: "provenance-employee",
			role: "manager",
		});
	});
	it("control: matching canonical workforce admin page and read admit wider population", async () => {
		h.employee.mockResolvedValue(employee("admin"));
		mount(await page(), "admin");
		expect(screen.getByText("outside-report private reason")).toBeTruthy();
		expect(h.sources).toContainEqual({
			kind: "approvals",
			organizationId: "provenance-org",
			employeeIds: ["managed-report", "outside-report"],
			approverId: "provenance-employee",
			includeAllApprovers: true,
		});
	});
	it("control: missing employee and ordinary employee read are refused before sources", async () => {
		h.employee.mockResolvedValue(null);
		expect(
			await readTodayBriefing({ userId: "provenance-user", organizationId: "provenance-org" }),
		).toEqual({ status: "unavailable" });
		h.employee.mockResolvedValue(employee("employee"));
		expect(
			await readTodayBriefing({ userId: "provenance-user", organizationId: "provenance-org" }),
		).toEqual({ status: "unavailable" });
		expect(h.build).not.toHaveBeenCalled();
	});
	it("control: mismatched published role retires the page seed and reads current manager rows", async () => {
		h.employee
			.mockResolvedValueOnce(employee("admin"))
			.mockResolvedValueOnce(employee("admin"))
			.mockResolvedValue(employee());
		await act(async () => mount(await page()));
		expect(screen.queryByText("outside-report private reason")).toBeNull();
		expect(screen.getByText("managed-report private reason")).toBeTruthy();
		expect(h.employee).toHaveBeenCalledTimes(3);
	});
	it("does not admit independently reloaded admin rows after manager return", async () => {
		// Page observes manager; read action independently observes temporary admin;
		// hydration/provider is back at manager. No provider admin publication occurs.
		h.employee
			.mockResolvedValueOnce(employee())
			.mockResolvedValueOnce(employee("admin"))
			.mockResolvedValue(employee());
		const element = await page();
		const provenance = {
			producer: element.props.initial.view,
			actionEmployee: h.build.mock.calls[0][0].currentEmployee,
			sourceCalls: h.sources,
		};
		await act(async () => mount(element));
		const observation = {
			...provenance,
			published: screen.getByTestId("published").textContent,
			outsideReasonVisible: !!screen.queryByText("outside-report private reason"),
			employeeReads: h.employee.mock.calls.length,
		};
		expect(observation.producer).toEqual({
			userId: "provenance-user",
			organizationId: "provenance-org",
			employeeId: "provenance-employee",
			role: "admin",
		});
		expect(observation.actionEmployee.role).toBe("admin");
		expect(observation.published).toBe(
			JSON.stringify(["provenance-user", "provenance-org", "provenance-employee", "manager"]),
		);
		expect(h.sources).toContainEqual({
			kind: "population",
			organizationId: "provenance-org",
			currentEmployeeId: "provenance-employee",
			role: "admin",
		});
		expect(observation.outsideReasonVisible).toBe(false);
	});
	it("retires a mismatched refresh producer and Retry rechecks context before recovery", async () => {
		mount(await page());
		expect(screen.getByText("managed-report private reason")).toBeTruthy();
		h.employee.mockResolvedValueOnce(employee("admin"));
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Refresh briefing control" }));
		});
		await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("unavailable"));
		expect(screen.queryByText("managed-report private reason")).toBeNull();
		expect(screen.queryByText("outside-report private reason")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Approve outside-report needs Leave approval" }),
		).toBeNull();
		const contextReadsBeforeRetry = vi.mocked(fetch).mock.calls.length;
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		});
		await waitFor(() => expect(screen.getByText("managed-report private reason")).toBeTruthy());
		expect(fetch).toHaveBeenCalledTimes(contextReadsBeforeRetry + 1);
		expect(screen.queryByText("outside-report private reason")).toBeNull();
	});
	it("initial evidence from a different employee must reread before admission", async () => {
		h.employee
			.mockResolvedValueOnce(employee())
			.mockResolvedValueOnce({ ...employee(), id: "replacement-employee" })
			.mockResolvedValue(employee());
		const element = await page();
		expect(element.props.initial.view.employeeId).toBe("replacement-employee");
		await act(async () => mount(element));
		expect(h.employee).toHaveBeenCalledTimes(3);
		expect(screen.getByText("managed-report private reason")).toBeTruthy();
		expect(screen.queryByText("outside-report private reason")).toBeNull();
	});
});
