/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionsPageClient } from "./permissions-page-client";

const mocks = vi.hoisted(() => ({
	loadPermissionsPageData: vi.fn(),
	toastError: vi.fn(),
	translate: (_key: string, fallback: string) => fallback,
	buildPermissionMap: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: mocks.translate }),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

vi.mock("./actions", () => ({
	loadPermissionsPageData: mocks.loadPermissionsPageData,
}));

vi.mock("./page-utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./page-utils")>();
	return {
		...actual,
		buildPermissionMap: (
			...args: Parameters<typeof actual.buildPermissionMap>
		) => {
			mocks.buildPermissionMap(...args);
			return actual.buildPermissionMap(...args);
		},
	};
});

vi.mock("./page-sections", () => ({
	PermissionEditorDialog: () => null,
	PermissionsEmptyState: () => <div>Empty</div>,
	PermissionsTableCard: ({
		employees,
		loading,
		onRefresh,
	}: {
		employees: Array<{ user: { name: string } }>;
		loading: boolean;
		onRefresh: () => Promise<void>;
	}) => (
		<div>
			<div>{loading ? "Loading permissions" : "Permissions loaded"}</div>
			<div>{employees.map((employee) => employee.user.name).join(",")}</div>
			<button type="button" onClick={() => void onRefresh()}>
				Refresh
			</button>
		</div>
	),
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function employeesResult(name: string) {
	return {
		success: true,
		data: {
			employees: [
				{
					id: name,
					position: null,
					user: { name, email: `${name}@example.test` },
				},
			],
		},
	};
}

function pageResult(organizationId: string, employeeName?: string) {
	return {
		success: true,
		data: {
			organizationId,
			employees: employeeName
				? employeesResult(employeeName).data.employees
				: [],
			teams: [],
			permissions: [],
		},
	};
}

describe("PermissionsPageClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadPermissionsPageData.mockReset();
		mocks.loadPermissionsPageData.mockImplementation(
			async (organizationId: string) => pageResult(organizationId),
		);
	});

	it("shows the empty state without loading organization data for a non-admin", async () => {
		render(
			<PermissionsPageClient
				organizationId="org-nonadmin"
				isOrgAdmin={false}
			/>,
		);

		expect(await screen.findByText("Empty")).toBeTruthy();
		expect(mocks.toastError).toHaveBeenCalledWith(
			"You must be an admin to manage permissions",
		);
		expect(mocks.loadPermissionsPageData).not.toHaveBeenCalled();
	});

	it("reports non-admin access exactly once in StrictMode", async () => {
		render(
			<StrictMode>
				<PermissionsPageClient
					organizationId="org-nonadmin"
					isOrgAdmin={false}
				/>
			</StrictMode>,
		);

		expect(await screen.findByText("Empty")).toBeTruthy();
		expect(mocks.toastError).toHaveBeenCalledTimes(1);
		expect(mocks.loadPermissionsPageData).not.toHaveBeenCalled();
	});

	it("shows the non-admin empty state after an organization switch without exposing old data", async () => {
		mocks.loadPermissionsPageData.mockResolvedValueOnce(
			pageResult("org-a", "Organization A Employee"),
		);

		const { rerender } = render(
			<PermissionsPageClient organizationId="org-a" isOrgAdmin />,
		);
		expect(await screen.findByText("Organization A Employee")).toBeTruthy();

		rerender(
			<PermissionsPageClient organizationId="org-b" isOrgAdmin={false} />,
		);

		expect(await screen.findByText("Empty")).toBeTruthy();
		expect(screen.queryByText("Organization A Employee")).toBeNull();
		expect(mocks.loadPermissionsPageData).toHaveBeenCalledTimes(1);
		expect(mocks.loadPermissionsPageData).toHaveBeenCalledWith("org-a");
	});

	it("does not let an earlier organization request overwrite newer employees", async () => {
		const first = deferred<ReturnType<typeof pageResult>>();
		const second = deferred<ReturnType<typeof pageResult>>();
		mocks.loadPermissionsPageData
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);

		const { rerender } = render(
			<PermissionsPageClient organizationId="org-old" isOrgAdmin />,
		);
		await waitFor(() =>
			expect(mocks.loadPermissionsPageData).toHaveBeenCalledOnce(),
		);

		rerender(<PermissionsPageClient organizationId="org-new" isOrgAdmin />);
		await waitFor(() =>
			expect(mocks.loadPermissionsPageData).toHaveBeenCalledTimes(2),
		);

		await act(async () => {
			second.resolve(pageResult("org-new", "New Employee"));
			await second.promise;
		});
		expect(await screen.findByText("New Employee")).toBeTruthy();

		await act(async () => {
			first.resolve(pageResult("org-old", "Old Employee"));
			await first.promise;
		});

		expect(screen.getByText("New Employee")).toBeTruthy();
		expect(screen.queryByText("Old Employee")).toBeNull();
		expect(mocks.loadPermissionsPageData).toHaveBeenNthCalledWith(1, "org-old");
		expect(mocks.loadPermissionsPageData).toHaveBeenNthCalledWith(2, "org-new");
	});

	it("hides the previous organization while the next organization loads", async () => {
		const nextPage = deferred<ReturnType<typeof pageResult>>();
		mocks.loadPermissionsPageData
			.mockResolvedValueOnce(pageResult("org-a", "Organization A Employee"))
			.mockReturnValueOnce(nextPage.promise);

		const { rerender } = render(
			<PermissionsPageClient organizationId="org-a" isOrgAdmin />,
		);
		expect(await screen.findByText("Organization A Employee")).toBeTruthy();

		rerender(<PermissionsPageClient organizationId="org-b" isOrgAdmin />);

		expect(screen.queryByText("Organization A Employee")).toBeNull();
		expect(screen.getByText("Loading permissions")).toBeTruthy();
	});

	it("does not let an organization refresh overwrite the next organization", async () => {
		const refreshPage = deferred<ReturnType<typeof pageResult>>();
		mocks.loadPermissionsPageData
			.mockResolvedValueOnce(pageResult("org-a", "Organization A Employee"))
			.mockReturnValueOnce(refreshPage.promise)
			.mockResolvedValueOnce(pageResult("org-b", "Organization B Employee"));

		const { rerender } = render(
			<PermissionsPageClient organizationId="org-a" isOrgAdmin />,
		);
		expect(await screen.findByText("Organization A Employee")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
		await waitFor(() =>
			expect(mocks.loadPermissionsPageData).toHaveBeenNthCalledWith(2, "org-a"),
		);

		rerender(<PermissionsPageClient organizationId="org-b" isOrgAdmin />);
		expect(await screen.findByText("Organization B Employee")).toBeTruthy();

		await act(async () => {
			refreshPage.resolve(pageResult("org-a", "Stale Organization A Employee"));
			await refreshPage.promise;
		});

		expect(screen.getByText("Organization B Employee")).toBeTruthy();
		expect(screen.queryByText("Stale Organization A Employee")).toBeNull();
		expect(mocks.loadPermissionsPageData).toHaveBeenNthCalledWith(3, "org-b");
	});

	it("settles bootstrap loading with a safe error when a data action rejects", async () => {
		mocks.loadPermissionsPageData.mockRejectedValueOnce(
			new Error("database connection details"),
		);

		render(<PermissionsPageClient organizationId="org-a" isOrgAdmin />);

		expect(await screen.findByText("Permissions loaded")).toBeTruthy();
		expect(mocks.toastError).toHaveBeenCalledWith("Failed to load employees");
		expect(screen.queryByText("database connection details")).toBeNull();
	});

	it("settles refresh loading with a safe error when a data action rejects", async () => {
		mocks.loadPermissionsPageData.mockResolvedValueOnce(
			pageResult("org-a", "Organization A Employee"),
		);

		render(<PermissionsPageClient organizationId="org-a" isOrgAdmin />);
		expect(await screen.findByText("Organization A Employee")).toBeTruthy();

		mocks.loadPermissionsPageData.mockRejectedValueOnce(
			new Error("permission service internals"),
		);
		fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

		await waitFor(() =>
			expect(screen.getByText("Permissions loaded")).toBeTruthy(),
		);
		expect(mocks.toastError).toHaveBeenLastCalledWith(
			"Failed to load employees",
		);
		expect(screen.queryByText("permission service internals")).toBeNull();
	});

	it("ignores a successful refresh after unmount", async () => {
		const refreshPage = deferred<ReturnType<typeof pageResult>>();
		mocks.loadPermissionsPageData
			.mockResolvedValueOnce(pageResult("org-a", "Organization A Employee"))
			.mockReturnValueOnce(refreshPage.promise);
		const { unmount } = render(
			<PermissionsPageClient organizationId="org-a" isOrgAdmin />,
		);
		expect(await screen.findByText("Organization A Employee")).toBeTruthy();
		mocks.buildPermissionMap.mockClear();

		fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
		await waitFor(() =>
			expect(mocks.loadPermissionsPageData).toHaveBeenCalledTimes(2),
		);
		unmount();
		await act(async () => {
			refreshPage.resolve(pageResult("org-a", "Late Employee"));
			await refreshPage.promise;
		});

		expect(mocks.buildPermissionMap).not.toHaveBeenCalled();
		expect(mocks.toastError).not.toHaveBeenCalled();
	});

	it("ignores a rejected refresh after unmount", async () => {
		let rejectRefresh!: (reason: unknown) => void;
		const refreshPage = new Promise<ReturnType<typeof pageResult>>(
			(_resolve, reject) => {
				rejectRefresh = reject;
			},
		);
		mocks.loadPermissionsPageData
			.mockResolvedValueOnce(pageResult("org-a", "Organization A Employee"))
			.mockReturnValueOnce(refreshPage);
		const { unmount } = render(
			<PermissionsPageClient organizationId="org-a" isOrgAdmin />,
		);
		expect(await screen.findByText("Organization A Employee")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
		await waitFor(() =>
			expect(mocks.loadPermissionsPageData).toHaveBeenCalledTimes(2),
		);
		unmount();
		await act(async () => {
			rejectRefresh(new Error("late failure"));
			await refreshPage.catch(() => undefined);
		});

		expect(mocks.toastError).not.toHaveBeenCalled();
	});

	it("gates admin controls immediately when the committed props downgrade", async () => {
		mocks.loadPermissionsPageData.mockResolvedValueOnce(
			pageResult("org-a", "Organization A Employee"),
		);
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		await act(async () => {
			root.render(<PermissionsPageClient organizationId="org-a" isOrgAdmin />);
		});
		expect(await screen.findByText("Organization A Employee")).toBeTruthy();

		act(() => {
			flushSync(() => {
				root.render(
					<PermissionsPageClient organizationId="org-a" isOrgAdmin={false} />,
				);
			});
			expect(screen.getByText("Empty")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
		});
		await act(async () => root.unmount());
		container.remove();
	});

	it("rejects a bootstrap payload whose organization identity does not match", async () => {
		mocks.loadPermissionsPageData.mockResolvedValueOnce({
			success: true,
			data: {
				organizationId: "org-other",
				employees: [employeesResult("Other Tenant Employee").data.employees[0]],
				teams: [],
				permissions: [],
			},
		});

		render(<PermissionsPageClient organizationId="org-a" isOrgAdmin />);

		await waitFor(() =>
			expect(mocks.loadPermissionsPageData).toHaveBeenCalled(),
		);
		expect(screen.queryByText("Other Tenant Employee")).toBeNull();
	});
});
