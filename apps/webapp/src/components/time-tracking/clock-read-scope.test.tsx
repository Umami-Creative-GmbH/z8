/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
	clientScope: { userId: "user-a", organizationId: "org-a" },
	serverScope: { userId: "user-a", organizationId: "org-a" },
	auth: vi.fn(),
	employee: vi.fn(),
	select: vi.fn(),
	form: vi.fn(),
	mode: vi.fn(),
	assignments: vi.fn(),
	tasks: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: {
			user: { id: boundary.clientScope.userId },
			session: { activeOrganizationId: boundary.clientScope.organizationId },
		},
		isPending: false,
	}),
}));
vi.mock("@/lib/auth-helpers", () => ({ getAuthContext: boundary.auth }));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/auth", () => ({
	getCurrentEmployee: boundary.employee,
	getCurrentSession: vi.fn(),
	getUserTimezone: vi.fn(),
}));
vi.mock("@/db", () => ({
	db: {
		select: boundary.select,
		query: {
			employee: { findFirst: boundary.employee },
			projectAssignment: { findMany: boundary.assignments },
		},
	},
}));
vi.mock("@/lib/auth/request-session", () => ({
	getRequestSession: async () => {
		const context = await boundary.auth();
		return context ? { user: context.user, session: context.session } : null;
	},
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/queries", () => ({
	getActiveWorkPeriod: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/shared", () => ({
	logger: { error: vi.fn() },
}));
vi.mock("@/lib/effect/runtime", () => ({ runtime: {} }));
vi.mock("@/lib/effect/services/change-policy.service", () => ({
	ChangePolicyService: {},
}));
vi.mock("@/lib/time-tracking/vehicle-use/form-context", () => ({
	loadWorkVehicleUseFormContext: boundary.form,
}));
vi.mock("@/lib/time-tracking/vehicle-use/resolver", () => ({
	resolveVehicleUseMode: boundary.mode,
}));
vi.mock("@/lib/time-tracking/vehicle-use/live-vehicle-use", () => ({
	changeLiveWorkVehicleUse: vi.fn(),
}));
vi.mock("@/lib/time-tracking/amend-completed-work", () => ({
	describeAmendmentFailure: vi.fn(),
}));
// Keep the actual public actions module. Only unrelated command/read ports are replaced.
vi.mock("@/app/[locale]/(app)/time-tracking/actions/clocking", () => ({}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/corrections", () => ({}));
vi.mock(
	"@/app/[locale]/(app)/time-tracking/actions/presence-status-read",
	() => ({}),
);
vi.mock(
	"@/app/[locale]/(app)/time-tracking/actions/work-period-split",
	() => ({}),
);
vi.mock(
	"@/app/[locale]/(app)/time-tracking/actions/manual-command-submission",
	() => ({}),
);
vi.mock("@/lib/time-tracking/work-period-attribution", () => ({}));
vi.mock("@/lib/time-tracking/compliance-totals", () => ({}));
vi.mock("@/lib/time-tracking/effective-work-policy", () => ({}));
vi.mock("@/lib/billable-time/settings", () => ({}));
vi.mock("@/lib/projects/project-tasks", () => ({
	listOpenTasksByProject: boundary.tasks,
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
	"@/app/[locale]/(app)/time-tracking/actions/vehicle-use-warnings",
	() => ({
		checkVehicleUseWarnings: vi.fn(),
	}),
);

import { getAssignedProjects } from "@/app/[locale]/(app)/time-tracking/actions";
import {
	getClockVehicleUseContext,
	getClockVehicleUseStatus,
} from "@/app/[locale]/(app)/time-tracking/actions/clock-vehicle-use";
import { queryKeys } from "@/lib/query/keys";
import { useAssignedProjects } from "@/lib/query/use-assigned-projects";
import { useClockVehicleUse } from "./clock-vehicle-use";

function authorizedEmployee() {
	return {
		id: `employee-${boundary.serverScope.organizationId}`,
		...boundary.serverScope,
		teamId: null,
	};
}
function authorizedContext() {
	return {
		user: { id: boundary.serverScope.userId },
		session: { activeOrganizationId: boundary.serverScope.organizationId },
		employee: authorizedEmployee(),
	};
}
function Choices() {
	const vehicles = useClockVehicleUse({ enabled: true });
	const projects = useAssignedProjects();
	return (
		<>
			<output data-testid="period">
				{vehicles.context?.live?.workPeriodId ?? "none"}
			</output>
			<output data-testid="vehicles">
				{vehicles.context?.vehicles.map((vehicle) => vehicle.name).join(",")}
			</output>
			<output data-testid="projects">
				{projects.projects.map((project) => project.name).join(",")}
			</output>
		</>
	);
}
function showChoices() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<Choices />
		</QueryClientProvider>,
	);
	return client;
}

beforeEach(() => {
	vi.clearAllMocks();
	boundary.clientScope = { userId: "user-a", organizationId: "org-a" };
	boundary.serverScope = { ...boundary.clientScope };
	boundary.auth.mockImplementation(async () => authorizedContext());
	boundary.employee.mockImplementation(async () => authorizedEmployee());
	boundary.select.mockImplementation(() => ({
		from: () => ({
			where: () =>
				Object.assign(Promise.resolve([]), {
					groupBy: async () => [],
					limit: async () => [
						{
							id: `period-${boundary.serverScope.organizationId}`,
							vehicleKind: "own",
							vehicleId: null,
							odometerStartKm: 100,
							odometerEndKm: null,
							drivenDistanceKm: null,
						},
					],
				}),
		}),
	}));
	boundary.mode.mockResolvedValue("asked");
	boundary.form.mockImplementation(async () => ({
		mode: "asked",
		vehicles: [
			{
				id: "van",
				name: `Van ${boundary.serverScope.organizationId}`,
				licencePlate: "TEST",
				archived: false,
			},
		],
	}));
	boundary.assignments.mockImplementation(async () => [
		{
			project: {
				id: "project",
				name: `Project ${boundary.serverScope.organizationId}`,
				color: null,
				status: "active",
				budgetHours: null,
				deadline: null,
				customerId: null,
				billableDefault: false,
				requiresTask: false,
			},
		},
	]);
	boundary.tasks.mockResolvedValue(new Map());
});
afterEach(cleanup);

it.each(["org-a", "org-b"])(
	"accepts valid %s reads through the actual public facades and query hooks",
	async (organizationId) => {
		boundary.clientScope.organizationId = organizationId;
		boundary.serverScope.organizationId = organizationId;
		const client = showChoices();
		await waitFor(() =>
			expect(screen.getByTestId("period").textContent).toBe(
				`period-${organizationId}`,
			),
		);
		expect(screen.getByTestId("vehicles").textContent).toBe(
			`Van ${organizationId}`,
		);
		expect(screen.getByTestId("projects").textContent).toBe(
			`Project ${organizationId}`,
		);
		expect(
			client.getQueryData(
				queryKeys.projects.assignable(organizationId, "user-a"),
			),
		).toBeDefined();
		expect(boundary.assignments).toHaveBeenCalledTimes(1);
		expect(boundary.tasks).toHaveBeenCalledWith({
			organizationId,
			projectIds: ["project"],
		});
	},
);

it.each([
	{ userId: "user-a", organizationId: "org-b" },
	{ userId: "user-b", organizationId: "org-a" },
	{ userId: "user-b", organizationId: "org-b" },
])(
	"rejects a delayed tab-A read admitted as $userId/$organizationId before protected reads",
	async (changedScope) => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		boundary.auth.mockImplementation(async () => {
			await gate;
			return authorizedContext();
		});
		boundary.employee.mockImplementation(async () => {
			await gate;
			return authorizedEmployee();
		});
		const client = showChoices();
		await waitFor(() => expect(boundary.auth).toHaveBeenCalledTimes(3));
		// Another tab changes the shared server session; this tab's captured session stays A.
		boundary.serverScope = changedScope;
		await act(async () => release());
		await waitFor(() => expect(client.isFetching()).toBe(0));
		expect(boundary.select).not.toHaveBeenCalled();
		expect(boundary.form).not.toHaveBeenCalled();
		expect(boundary.mode).not.toHaveBeenCalled();
		expect(boundary.assignments).not.toHaveBeenCalled();
		for (const query of client.getQueryCache().getAll()) {
			expect(query.state.status).toBe("error");
			expect(query.state.data).toBeUndefined();
		}
		expect(screen.getByTestId("period").textContent).toBe("none");
		expect(screen.getByTestId("vehicles").textContent).toBe("");
		expect(screen.getByTestId("projects").textContent).toBe("");
	},
);

it.each(["signed-out", "revoked"])(
	"keeps %s admission authoritative even when the expected identity matches",
	async (denial) => {
		boundary.auth.mockResolvedValue(
			denial === "signed-out"
				? null
				: { ...authorizedContext(), employee: null },
		);
		boundary.employee.mockResolvedValue(null);
		const client = showChoices();
		await waitFor(() => expect(client.isFetching()).toBe(0));
		expect(
			client
				.getQueryCache()
				.getAll()
				.every((query) => query.state.status === "error"),
		).toBe(true);
		expect(boundary.select).not.toHaveBeenCalled();
		expect(boundary.assignments).not.toHaveBeenCalled();
	},
);

it.each([null, {}, { userId: "user-a" }, { organizationId: "org-a" }])(
	"rejects a malformed supplied expectation without protected reads: %j",
	async (expected) => {
		for (const read of [
			getClockVehicleUseStatus,
			getClockVehicleUseContext,
			getAssignedProjects,
		]) {
			expect(await Reflect.apply(read, undefined, [expected])).toMatchObject({
				success: false,
			});
		}
		expect(boundary.select).not.toHaveBeenCalled();
		expect(boundary.form).not.toHaveBeenCalled();
		expect(boundary.assignments).not.toHaveBeenCalled();
	},
);

it("retains argument-less public callers with fresh authorization", async () => {
	expect(await getClockVehicleUseStatus()).toMatchObject({ success: true });
	expect(await getClockVehicleUseContext()).toMatchObject({ success: true });
	expect(await getAssignedProjects()).toMatchObject({ success: true });
});
