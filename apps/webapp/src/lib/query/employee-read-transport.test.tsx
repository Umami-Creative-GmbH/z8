/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { useCustomFieldDrafts } from "@/components/settings/custom-fields/use-custom-field-drafts";
import { useOrganization } from "@/hooks/use-organization";
import type { OrganizationDisplayContext } from "@/lib/auth/organization-display-context";
import type { EmployeeReadSnapshot } from "@/lib/organization/employee-read-types";
import { useEmployee } from "./use-employee";
import { useEmployees } from "./use-employees";

const state = vi.hoisted(() => ({
	fetch: vi.fn(),
	getCurrentEmployee: vi.fn(),
	listEmployees: vi.fn(),
	oldRead: vi.fn(),
	updateDraft: vi.fn(),
	updateReal: vi.fn(),
	customFields: vi.fn(),
	session: {
		user: { id: "viewer-1" },
		session: { activeOrganizationId: "org-1" },
	},
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({ data: state.session, isPending: false }),
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/app/[locale]/(app)/settings/custom-fields/value-actions", () => ({
	getCustomFieldSection: state.customFields,
}));
vi.mock("@/app/[locale]/(app)/approvals/actions", () => ({
	getCurrentEmployee: state.getCurrentEmployee,
}));
vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
	listEmployees: state.listEmployees,
	getEmployee: state.oldRead,
	listEmployeesForSelect: state.oldRead,
	requestEmployeeWorkBalanceRecalculation: vi.fn(),
	updateEmployee: state.updateReal,
	updateEmployeeInvitationDraft: state.updateDraft,
}));
vi.mock(
	"@/app/[locale]/(app)/settings/employees/employment-history-client-actions",
	() => ({
		listEmployeeEmploymentHistoryAction: state.oldRead,
		cancelEmployeeEmploymentHistoryAction: vi.fn(),
		changeEmployeeWageAction: vi.fn(),
		confirmEmployeeEmploymentHistoryAction: vi.fn(),
		createEmployeeEmploymentHistoryAction: vi.fn(),
	}),
);
vi.mock("@/app/[locale]/(app)/settings/work-policies/actions", () => ({
	getEmployeeEffectiveScheduleDetails: state.oldRead,
	getWorkPolicies: state.oldRead,
}));

const bootstrap: OrganizationDisplayContext = {
	userId: "viewer-1",
	organizationId: "org-1",
	employee: {
		employeeId: "viewer-employee",
		organizationId: "org-1",
		role: "manager",
	},
	organizationSettings: null,
	updatedAt: 0,
};

function provider(children: ReactNode, initial = bootstrap) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const tree = (context: OrganizationDisplayContext) => (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider
				initialContext={{ ...context, updatedAt: Date.now() }}
			>
				{children}
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
	const result = render(tree(initial));
	return {
		...result,
		replaceScope: (context: OrganizationDisplayContext) =>
			result.rerender(tree(context)),
	};
}

function Directory({
	accessTier = "manager",
}: {
	accessTier?: "manager" | "orgAdmin";
}) {
	const result = useEmployees({
		organizationId: "org-1",
		accessTier,
	});
	return (
		<p>
			{result.isError
				? result.error?.message
				: (result.employees[0]?.user.name ?? "Loading employees")}
		</p>
	);
}

function ScopedCustomFields() {
	const { userId, activeOrganizationId } = useOrganization();
	const { section } = useCustomFieldDrafts({
		entity: "employee",
		recordId: "person-1",
		enabled: Boolean(userId && activeOrganizationId),
		readScope:
			userId && activeOrganizationId
				? { userId, organizationId: activeOrganizationId }
				: undefined,
	});
	return <p>{section?.fields[0]?.name ?? "No visible fields"}</p>;
}

function Detail({
	initialSnapshot,
}: {
	initialSnapshot: EmployeeReadSnapshot<"detail">;
}) {
	const data = useEmployee({
		employeeId:
			initialSnapshot.data.kind === "invitationDraft"
				? initialSnapshot.data.encodedId
				: initialSnapshot.data.id,
		accessTier: "orgAdmin",
		initialSnapshot,
	});
	return (
		<>
			<p>{data.employee?.user.name ?? "Loading employee"}</p>
			<p>
				{data.availableManagers.length} manager /{" "}
				{data.employmentHistory.length} history / {data.workPolicies.length}{" "}
				policy
			</p>
			{data.readErrors.employmentHistory ? (
				<p role="alert">{data.readErrors.employmentHistory.message}</p>
			) : null}
			<button
				type="button"
				onClick={() => void data.updateEmployee({ firstName: "Prepared Pat" })}
			>
				Save employee
			</button>
			<button
				type="button"
				onClick={() => void data.refetch()}
				disabled={data.isFetching}
			>
				Refresh employee
			</button>
		</>
	);
}

describe("employee read transport through the shared provider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.session = {
			user: { id: "viewer-1" },
			session: { activeOrganizationId: "org-1" },
		};
		vi.stubGlobal("fetch", state.fetch);
		state.getCurrentEmployee.mockImplementation(() => new Promise(() => {}));
		state.oldRead.mockImplementation(() => new Promise(() => {}));
		state.updateDraft.mockResolvedValue({
			success: false,
			error: "Fixture refusal",
		});
		state.updateReal.mockResolvedValue({
			success: false,
			error: "Fixture refusal",
		});
		state.fetch.mockImplementation(async () =>
			Response.json({
				scope: { userId: "viewer-1", organizationId: "org-1" },
				updatedAt: Date.now(),
				data: {
					employees: [
						{
							id: "person-1",
							kind: "employee",
							organizationId: "org-1",
							user: { name: "Pat River" },
						},
					],
					total: 1,
					hasMore: false,
				},
			}),
		);
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("starts a manager directory GET from bootstrap without a current-employee action", async () => {
		provider(<Directory />);
		expect(await screen.findByText("Pat River")).toBeTruthy();
		expect(state.fetch).toHaveBeenCalledTimes(1);
		expect(state.getCurrentEmployee).not.toHaveBeenCalled();
		expect(state.listEmployees).not.toHaveBeenCalled();
	});

	it("uses the authorized server detail and starts independent reads while its schedule is held", async () => {
		let releaseSchedule!: () => void;
		state.fetch.mockImplementation((url: string) => {
			const dataset = new URL(url, "http://localhost").pathname
				.split("/")
				.at(-1);
			const response = (data: unknown) =>
				Response.json({
					scope: { userId: "viewer-1", organizationId: "org-1" },
					data,
					updatedAt: Date.now(),
				});
			if (dataset === "schedule")
				return new Promise((resolve) => {
					releaseSchedule = () => resolve(response(null));
				});
			if (dataset === "managers")
				return Promise.resolve(
					response([{ id: "manager-1", user: { name: "Manager person" } }]),
				);
			if (dataset === "employment-history")
				return Promise.resolve(response([{ id: "terms-1" }]));
			if (dataset === "work-policies")
				return Promise.resolve(
					response([{ id: "policy-1", name: "Weekdays" }]),
				);
			throw new Error(`Unexpected initial read: ${dataset}`);
		});
		provider(
			<Detail
				initialSnapshot={{
					scope: { userId: "viewer-1", organizationId: "org-1" },
					updatedAt: Date.now(),
					data: {
						id: "person-1",
						kind: "employee",
						organizationId: "org-1",
						user: { name: "Pat River" },
					},
				}}
			/>,
		);
		expect(await screen.findByText("Pat River")).toBeTruthy();
		expect(
			await screen.findByText("1 manager / 1 history / 1 policy"),
		).toBeTruthy();
		await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(4));
		expect(state.oldRead).not.toHaveBeenCalled();
		expect(state.getCurrentEmployee).not.toHaveBeenCalled();
		releaseSchedule();
	});

	it("does not load employee-only data for an invitation draft and keeps the draft write path", async () => {
		provider(
			<Detail
				initialSnapshot={{
					scope: { userId: "viewer-1", organizationId: "org-1" },
					updatedAt: Date.now(),
					data: {
						id: "draft-1",
						encodedId: "draft:draft-1",
						kind: "invitationDraft",
						organizationId: "org-1",
						user: { name: "Prepared Pat" },
						realEmployeeId: null,
					},
				}}
			/>,
		);
		expect(await screen.findByText("Prepared Pat")).toBeTruthy();
		expect(state.fetch).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Save employee" }));
		await waitFor(() => expect(state.updateDraft).toHaveBeenCalled());
		expect(state.updateReal).not.toHaveBeenCalled();
	});

	it("refuses accepted draft edits before submitting either write path", async () => {
		provider(
			<Detail
				initialSnapshot={{
					scope: { userId: "viewer-1", organizationId: "org-1" },
					updatedAt: Date.now(),
					data: {
						id: "draft-1",
						encodedId: "draft:draft-1",
						kind: "invitationDraft",
						organizationId: "org-1",
						user: { name: "Accepted Pat" },
						realEmployeeId: "person-1",
					},
				}}
			/>,
		);
		expect(await screen.findByText("Accepted Pat")).toBeTruthy();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "Save employee" })),
		);
		expect(state.updateDraft).not.toHaveBeenCalled();
		expect(state.updateReal).not.toHaveBeenCalled();
		expect(state.fetch).not.toHaveBeenCalled();
	});

	it("shows a real optional-read error while the authorized detail remains usable", async () => {
		state.fetch.mockImplementation(async (url: string) => {
			const dataset = new URL(url, "http://localhost").pathname
				.split("/")
				.at(-1);
			return dataset === "employment-history"
				? Response.json({ error: "History unavailable" }, { status: 503 })
				: Response.json({
						scope: { userId: "viewer-1", organizationId: "org-1" },
						updatedAt: Date.now(),
						data: dataset === "schedule" ? null : [],
					});
		});
		provider(
			<Detail
				initialSnapshot={{
					scope: { userId: "viewer-1", organizationId: "org-1" },
					updatedAt: Date.now(),
					data: {
						id: "person-1",
						kind: "employee",
						organizationId: "org-1",
						user: { name: "Pat River" },
					},
				}}
			/>,
		);
		expect((await screen.findByRole("alert")).textContent).toBe(
			"History unavailable",
		);
		expect(screen.getByText("Pat River")).toBeTruthy();
		expect(
			state.fetch.mock.calls.filter(([url]) =>
				String(url).includes("/employment-history"),
			),
		).toHaveLength(1);
	});

	it("does not expose a response whose scope differs from its request", async () => {
		state.fetch.mockImplementation(async () =>
			Response.json({
				scope: { userId: "different-user", organizationId: "org-1" },
				data: { employees: [{ user: { name: "Wrong person" } }] },
				updatedAt: Date.now(),
			}),
		);
		provider(<Directory />);
		expect(
			await screen.findByText("Employee context changed. Refresh to continue."),
		).toBeTruthy();
		expect(screen.queryByText("Wrong person")).toBeNull();
	});

	it("does not paint an old user's delayed response after identity replacement", async () => {
		let finishOld!: () => void;
		state.fetch.mockImplementation((url: string, options: RequestInit) => {
			const userId = (options.headers as Record<string, string>)[
				"x-z8-context-user"
			];
			const response = (name: string) =>
				Response.json({
					scope: { userId, organizationId: "org-1" },
					data: {
						employees: [{ id: "person-1", user: { name } }],
						total: 1,
						hasMore: false,
					},
					updatedAt: Date.now(),
				});
			return userId === "viewer-1"
				? new Promise((resolve) => {
						finishOld = () => resolve(response("Old Pat"));
					})
				: Promise.resolve(response("New Robin"));
		});
		const view = provider(<Directory />);
		await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
		state.session = {
			user: { id: "viewer-2" },
			session: { activeOrganizationId: "org-1" },
		};
		view.replaceScope({
			...bootstrap,
			userId: "viewer-2",
			employee: {
				employeeId: "viewer-2-employee",
				organizationId: "org-1",
				role: "manager",
			},
		});
		expect(await screen.findByText("New Robin")).toBeTruthy();
		await act(async () => finishOld());
		expect(screen.queryByText("Old Pat")).toBeNull();
		expect(screen.getByText("New Robin")).toBeTruthy();
	});

	it("uses the active organization for an administrator without an employee profile", async () => {
		provider(<Directory accessTier="orgAdmin" />, {
			...bootstrap,
			employee: null,
		});
		expect(await screen.findByText("Pat River")).toBeTruthy();
		expect(state.fetch).toHaveBeenCalledTimes(1);
		expect(state.getCurrentEmployee).not.toHaveBeenCalled();
	});

	it("does not reuse a broader custom-field section for the next viewer of the same employee", async () => {
		state.customFields.mockResolvedValueOnce({
			success: true,
			data: {
				fields: [{ id: "private", name: "Private administrator field" }],
				history: {},
			},
		});
		let finishRestricted!: () => void;
		state.customFields.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishRestricted = () =>
						resolve({ success: true, data: { fields: [], history: {} } });
				}),
		);
		const view = provider(<ScopedCustomFields />);
		expect(await screen.findByText("Private administrator field")).toBeTruthy();
		state.session = {
			user: { id: "viewer-2" },
			session: { activeOrganizationId: "org-1" },
		};
		view.replaceScope({
			...bootstrap,
			userId: "viewer-2",
			employee: {
				employeeId: "viewer-2-employee",
				organizationId: "org-1",
				role: "manager",
			},
		});
		expect(screen.queryByText("Private administrator field")).toBeNull();
		await waitFor(() => expect(state.customFields).toHaveBeenCalledTimes(2));
		await act(async () => finishRestricted());
		expect(screen.getByText("No visible fields")).toBeTruthy();
	});

	it("refreshes each visible dataset once and keeps mutation refresh limited to affected detail data", async () => {
		const person = {
			id: "person-1",
			kind: "employee",
			organizationId: "org-1",
			user: { name: "Pat River" },
		};
		state.fetch.mockImplementation(async (url: string) => {
			const dataset = new URL(url, "http://localhost").pathname
				.split("/")
				.at(-1);
			return Response.json({
				scope: { userId: "viewer-1", organizationId: "org-1" },
				updatedAt: Date.now(),
				data:
					dataset === "detail" ? person : dataset === "schedule" ? null : [],
			});
		});
		state.updateReal.mockResolvedValue({ success: true, data: person });
		provider(
			<Detail
				initialSnapshot={{
					scope: { userId: "viewer-1", organizationId: "org-1" },
					updatedAt: Date.now(),
					data: person,
				}}
			/>,
		);
		const refresh = screen.getByRole("button", { name: "Refresh employee" });
		await waitFor(() => expect(refresh.hasAttribute("disabled")).toBe(false));
		expect(state.fetch).toHaveBeenCalledTimes(4);
		state.fetch.mockClear();
		fireEvent.click(refresh);
		await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(5));
		await waitFor(() => expect(refresh.hasAttribute("disabled")).toBe(false));
		const datasets = state.fetch.mock.calls.map(([url]) =>
			new URL(url, "http://localhost").pathname.split("/").at(-1),
		);
		expect(datasets.sort()).toEqual([
			"detail",
			"employment-history",
			"managers",
			"schedule",
			"work-policies",
		]);
		state.fetch.mockClear();
		fireEvent.click(screen.getByRole("button", { name: "Save employee" }));
		await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(3));
		expect(
			state.fetch.mock.calls
				.map(([url]) =>
					new URL(url, "http://localhost").pathname.split("/").at(-1),
				)
				.sort(),
		).toEqual(["detail", "employment-history", "schedule"]);
	});
});
