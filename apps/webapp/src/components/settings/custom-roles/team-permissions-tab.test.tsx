/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectableEmployee } from "@/app/[locale]/(app)/settings/employees/employee-action-types";
import type { EmployeePermissions } from "@/lib/effect/services/permissions.service";
import { TeamPermissionsTab } from "./team-permissions-tab";

const mocks = vi.hoisted(() => ({
	loadPermissionsPageData: vi.fn(),
	grantTeamPermissions: vi.fn(),
	revokeTeamPermissions: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
	translate: (_key: string, fallback: string, params?: Record<string, string | number>) =>
		Object.entries(params ?? {}).reduce(
			(text, [paramKey, paramValue]) => text.replace(`{${paramKey}}`, String(paramValue)),
			fallback,
		),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: mocks.translate }),
}));

vi.mock("sonner", () => ({
	toast: {
		error: mocks.toastError,
		success: mocks.toastSuccess,
	},
}));

vi.mock("@/app/[locale]/(app)/settings/roles/team-permission-actions", () => ({
	loadPermissionsPageData: mocks.loadPermissionsPageData,
	grantTeamPermissions: mocks.grantTeamPermissions,
	revokeTeamPermissions: mocks.revokeTeamPermissions,
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: () => <div data-testid="user-avatar" />,
}));

vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({ getStatus: () => "unknown" }),
}));

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: ({ open, children }: { open: boolean; children: ReactNode }) =>
		open ? <div role="dialog">{children}</div> : null,
	ActionPanelBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/checkbox", () => ({
	Checkbox: ({
		id,
		checked,
		disabled,
		onCheckedChange,
	}: {
		id: string;
		checked: boolean;
		disabled?: boolean;
		onCheckedChange: (checked: boolean) => void;
	}) => (
		<input
			type="checkbox"
			id={id}
			aria-label={id}
			checked={checked}
			disabled={disabled}
			onChange={(event) => onCheckedChange(event.target.checked)}
		/>
	),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	SelectValue: () => null,
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function makeEmployee(overrides: {
	id: string;
	name: string;
	email?: string;
	position?: string | null;
	role?: "admin" | "manager" | "employee";
}): SelectableEmployee {
	return {
		id: overrides.id,
		userId: `user-${overrides.id}`,
		firstName: overrides.name.split(" ")[0] ?? overrides.name,
		lastName: overrides.name.split(" ")[1] ?? "",
		pronouns: null,
		position: overrides.position ?? null,
		role: overrides.role ?? "employee",
		isActive: true,
		teamId: null,
		user: {
			id: `user-${overrides.id}`,
			firstName: overrides.name.split(" ")[0] ?? overrides.name,
			lastName: overrides.name.split(" ")[1] ?? "",
			name: overrides.name,
			email: overrides.email ?? `${overrides.id}@example.test`,
			image: null,
		},
		team: null,
	};
}

function makePermission(
	employeeId: string,
	organizationId: string,
	overrides: Partial<EmployeePermissions> = {},
): EmployeePermissions {
	return {
		employeeId,
		organizationId,
		teamId: null,
		canCreateTeams: false,
		canManageTeamMembers: false,
		canManageTeamSettings: false,
		canApproveTeamRequests: false,
		grantedBy: "admin-1",
		grantedAt: new Date("2026-07-29T08:00:00.000Z"),
		...overrides,
	};
}

function pageResult(
	organizationId: string,
	options: {
		employees?: SelectableEmployee[];
		teams?: Array<{ id: string; name: string; organizationId: string }>;
		permissions?: Array<{
			employee: { id: string };
			permissions: EmployeePermissions[];
		}>;
	} = {},
) {
	return {
		success: true as const,
		data: {
			organizationId,
			employees: options.employees ?? [],
			teams: options.teams ?? [],
			permissions: options.permissions ?? [],
		},
	};
}

describe("TeamPermissionsTab", () => {
	afterEach(() => {
		cleanup();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadPermissionsPageData.mockReset();
		mocks.grantTeamPermissions.mockResolvedValue({ success: true });
		mocks.revokeTeamPermissions.mockResolvedValue({ success: true });
		mocks.loadPermissionsPageData.mockResolvedValue(pageResult("org-a"));
	});

	it("renders permission summaries, hides edit for admins, and filters employees by search", async () => {
		const ada = makeEmployee({
			id: "emp-admin",
			name: "Ada Lovelace",
			email: "ada@example.test",
			position: "Operations Lead",
			role: "admin",
		});
		const grace = makeEmployee({
			id: "emp-grace",
			name: "Grace Hopper",
			email: "grace@example.test",
			position: "Coordinator",
			role: "employee",
		});
		const alan = makeEmployee({
			id: "emp-alan",
			name: "Alan Turing",
			email: "alan@example.test",
			position: "Analyst",
			role: "manager",
		});

		mocks.loadPermissionsPageData.mockResolvedValueOnce(
			pageResult("org-a", {
				employees: [ada, grace, alan],
				teams: [{ id: "team-1", name: "Platform", organizationId: "org-a" }],
				permissions: [
					{
						employee: { id: grace.id },
						permissions: [
							makePermission(grace.id, "org-a", {
								teamId: "team-1",
								canCreateTeams: true,
								canManageTeamMembers: true,
							}),
						],
					},
					{
						employee: { id: alan.id },
						permissions: [],
					},
				],
			}),
		);

		render(<TeamPermissionsTab organizationId="org-a" />);

		expect(await screen.findByText("Grace Hopper")).toBeTruthy();
		expect(screen.getByText("All Permissions")).toBeTruthy();
		expect(screen.getByText("2 permission(s)")).toBeTruthy();
		expect(screen.getByText("Team-specific")).toBeTruthy();
		expect(screen.getByText("No permissions")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Edit permissions for Ada Lovelace" })).toBeNull();
		expect(screen.getByRole("button", { name: "Edit permissions for Grace Hopper" })).toBeTruthy();

		// Search by position
		const searchInput = screen.getByRole("searchbox", {
			name: "Search employees",
		});
		fireEvent.change(searchInput, { target: { value: "Coordinator" } });

		expect(screen.getByText("Grace Hopper")).toBeTruthy();
		expect(screen.queryByText("Ada Lovelace")).toBeNull();
		expect(screen.queryByText("Alan Turing")).toBeNull();
		expect(mocks.toastError).not.toHaveBeenCalled();
	});

	it("opens the permission editor panel, grants permissions, and refreshes the table", async () => {
		const grace = makeEmployee({
			id: "emp-grace",
			name: "Grace Hopper",
			role: "employee",
		});
		mocks.loadPermissionsPageData
			.mockResolvedValueOnce(
				pageResult("org-a", {
					employees: [grace],
					teams: [{ id: "team-1", name: "Platform", organizationId: "org-a" }],
					permissions: [{ employee: { id: grace.id }, permissions: [] }],
				}),
			)
			.mockResolvedValueOnce(
				pageResult("org-a", {
					employees: [grace],
					teams: [{ id: "team-1", name: "Platform", organizationId: "org-a" }],
					permissions: [
						{
							employee: { id: grace.id },
							permissions: [makePermission(grace.id, "org-a", { canCreateTeams: true })],
						},
					],
				}),
			);

		render(<TeamPermissionsTab organizationId="org-a" />);
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Edit permissions for Grace Hopper",
			}),
		);

		expect(screen.getByRole("heading", { name: "Edit Permissions - Grace Hopper" })).toBeTruthy();

		fireEvent.click(screen.getByRole("checkbox", { name: "canCreateTeams" }));
		fireEvent.click(screen.getByRole("button", { name: "Save Permissions" }));

		await waitFor(() => expect(mocks.grantTeamPermissions).toHaveBeenCalledOnce());
		expect(mocks.grantTeamPermissions).toHaveBeenCalledWith({
			employeeId: "emp-grace",
			teamId: null,
			permissions: {
				canCreateTeams: true,
				canManageTeamMembers: false,
				canManageTeamSettings: false,
				canApproveTeamRequests: false,
			},
		});
		expect(await screen.findByText("1 permission(s)")).toBeTruthy();
		expect(screen.getByText("Organization-wide")).toBeTruthy();
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("revokes existing team permissions from the editor panel and refreshes the table", async () => {
		const grace = makeEmployee({
			id: "emp-grace",
			name: "Grace Hopper",
			role: "employee",
		});
		mocks.loadPermissionsPageData
			.mockResolvedValueOnce(
				pageResult("org-a", {
					employees: [grace],
					teams: [{ id: "team-1", name: "Platform", organizationId: "org-a" }],
					permissions: [
						{
							employee: { id: grace.id },
							permissions: [
								makePermission(grace.id, "org-a", {
									teamId: "team-1",
									canApproveTeamRequests: true,
								}),
							],
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				pageResult("org-a", {
					employees: [grace],
					teams: [{ id: "team-1", name: "Platform", organizationId: "org-a" }],
					permissions: [{ employee: { id: grace.id }, permissions: [] }],
				}),
			);

		render(<TeamPermissionsTab organizationId="org-a" />);
		expect(await screen.findByText("1 permission(s)")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Edit permissions for Grace Hopper" }));
		fireEvent.click(screen.getByRole("button", { name: "Revoke All" }));

		await waitFor(() => expect(mocks.revokeTeamPermissions).toHaveBeenCalledOnce());
		expect(mocks.revokeTeamPermissions).toHaveBeenCalledWith({
			employeeId: "emp-grace",
			teamId: "team-1",
		});
		expect(await screen.findByText("No permissions")).toBeTruthy();
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("hides previous organization employees while switching organizations and ignores stale responses", async () => {
		const first = deferred<ReturnType<typeof pageResult>>();
		const second = deferred<ReturnType<typeof pageResult>>();
		mocks.loadPermissionsPageData
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);

		const { rerender } = render(<TeamPermissionsTab organizationId="org-old" />);
		await waitFor(() => expect(mocks.loadPermissionsPageData).toHaveBeenCalledOnce());

		rerender(<TeamPermissionsTab organizationId="org-new" />);
		await waitFor(() => expect(mocks.loadPermissionsPageData).toHaveBeenCalledTimes(2));

		await act(async () => {
			second.resolve(
				pageResult("org-new", {
					employees: [makeEmployee({ id: "emp-new", name: "New Employee" })],
				}),
			);
			await second.promise;
		});
		expect(await screen.findByText("New Employee")).toBeTruthy();

		await act(async () => {
			first.resolve(
				pageResult("org-old", {
					employees: [makeEmployee({ id: "emp-old", name: "Old Employee" })],
				}),
			);
			await first.promise;
		});

		expect(screen.getByText("New Employee")).toBeTruthy();
		expect(screen.queryByText("Old Employee")).toBeNull();
	});

	it("rejects a bootstrap payload whose organization identity does not match", async () => {
		mocks.loadPermissionsPageData.mockResolvedValueOnce(
			pageResult("org-other", {
				employees: [makeEmployee({ id: "emp-other", name: "Other Tenant Employee" })],
			}),
		);

		render(<TeamPermissionsTab organizationId="org-a" />);

		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.queryByText("Other Tenant Employee")).toBeNull();
		expect(mocks.toastError).toHaveBeenCalledWith("Failed to load employees");
	});

	it("shows a safe load failure alert with retry distinct from an empty employee list", async () => {
		mocks.loadPermissionsPageData
			.mockRejectedValueOnce(new Error("database connection details"))
			.mockResolvedValueOnce(
				pageResult("org-a", {
					employees: [makeEmployee({ id: "emp-1", name: "Recovered User" })],
				}),
			);

		render(<TeamPermissionsTab organizationId="org-a" />);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain("Employee permissions could not be loaded.");
		expect(screen.queryByText("No employees found")).toBeNull();
		expect(screen.queryByText("database connection details")).toBeNull();
		expect(mocks.toastError).toHaveBeenCalledWith("Failed to load employees");

		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(await screen.findByText("Recovered User")).toBeTruthy();
	});

	it("ignores late refresh results after unmount", async () => {
		const refreshDeferred = deferred<ReturnType<typeof pageResult>>();
		mocks.loadPermissionsPageData
			.mockResolvedValueOnce(
				pageResult("org-a", {
					employees: [makeEmployee({ id: "emp-1", name: "Initial Employee" })],
				}),
			)
			.mockReturnValueOnce(refreshDeferred.promise);

		const { unmount } = render(<TeamPermissionsTab organizationId="org-a" />);
		expect(await screen.findByText("Initial Employee")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
		await waitFor(() => expect(mocks.loadPermissionsPageData).toHaveBeenCalledTimes(2));

		unmount();
		await act(async () => {
			refreshDeferred.resolve(
				pageResult("org-a", {
					employees: [makeEmployee({ id: "emp-2", name: "Late Employee" })],
				}),
			);
			await refreshDeferred.promise;
		});

		expect(mocks.toastError).not.toHaveBeenCalled();
	});
});
