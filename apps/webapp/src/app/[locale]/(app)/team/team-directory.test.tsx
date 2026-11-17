/* @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, type ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamDirectory } from "./team-directory";
import { TeamDirectoryLoading } from "./team-directory-feedback";

const seams = vi.hoisted(() => ({
	current: vi.fn(),
	managed: vi.fn(),
	redirect: vi.fn(),
	refresh: vi.fn(),
	context: {
		userId: "actor-a",
		activeOrganizationId: "org-a",
		employeeId: "manager-a",
		role: "manager",
		isLoading: false,
		refetch: async () => {},
	},
	session: {
		isPending: false,
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
	},
}));

vi.mock("@/lib/auth-client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth-client")>()),
	useSession: () => seams.session,
}));
vi.mock("./actions", () => ({
	getCurrentEmployee: seams.current,
	getManagedEmployees: seams.managed,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({ redirectWithLocale: seams.redirect }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: seams.refresh }),
	Link: (props: ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("@/components/providers/organization-context-provider", async () => {
	const { useSyncExternalStore } = await import("react");
	return {
		useOrganization: () => {
			// Match the live provider's subscription on Activity reactivation.
			useSyncExternalStore(
				() => () => {},
				() => JSON.stringify(seams.context),
			);
			return seams.context;
		},
	};
});
vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({
		getStatus: () => "unknown",
		getActivity: () => null,
		getBreak: () => null,
	}),
}));

describe("team directory arrivals", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		seams.session = {
			isPending: false,
			data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
		};
		seams.context = {
			userId: "actor-a",
			activeOrganizationId: "org-a",
			employeeId: "manager-a",
			role: "manager",
			isLoading: false,
			refetch: async () => {},
		};
		seams.current.mockResolvedValue({
			id: "manager-a",
			userId: "actor-a",
			organizationId: "org-a",
			role: "manager",
		});
		seams.managed.mockResolvedValue({ success: false, error: "Private failure detail" });
	});

	it("retains usable records and the search when a refresh fails", async () => {
		seams.managed.mockResolvedValueOnce({
			success: true,
			data: [
				{
					id: "report-a",
					role: "employee",
					isFormer: false,
					user: { id: "person-a", name: "Ada", email: "ada@example.test", image: null },
					timeBalance: null,
					team: null,
				},
			],
		});
		const page = render(await TeamDirectory({ searchParams: Promise.resolve({}) }));
		fireEvent.change(screen.getByRole("textbox", { name: "Search team members" }), {
			target: { value: "Ada" },
		});
		page.rerender(await TeamDirectory({ searchParams: Promise.resolve({}) }));
		expect(screen.getByRole("link", { name: "Ada" })).toBeTruthy();
		expect(
			(screen.getByRole("textbox", { name: "Search team members" }) as HTMLInputElement).value,
		).toBe("Ada");
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});
	it("keeps a single task heading and a real refresh recovery on read failure", async () => {
		render(await TeamDirectory({ searchParams: Promise.resolve({ former: "1" }) }));
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		expect(screen.getByRole("alert").textContent).toBe("Unable to load your team members.");
		expect(screen.queryByText("Private failure detail")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(seams.refresh).toHaveBeenCalledOnce());
		expect(seams.managed).toHaveBeenCalledWith({ includeFormer: true });
	});
	it("redirects employee-role arrivals without loading managed records", async () => {
		seams.current.mockResolvedValue({ role: "employee" });
		await TeamDirectory({ searchParams: Promise.resolve({}) });
		expect(seams.redirect).toHaveBeenCalledWith("/");
		expect(seams.managed).not.toHaveBeenCalled();
	});
	it("announces loading while retaining the directory heading", () => {
		render(<TeamDirectoryLoading />);
		expect(screen.getByRole("heading", { level: 1, name: "Your Team" })).toBeTruthy();
		expect(
			screen.getByRole("status", { name: "Loading team members" }).getAttribute("aria-busy"),
		).toBe("true");
	});

	it("withholds retained records while the raw session is pending despite a retained organization context", async () => {
		seams.managed.mockResolvedValue({
			success: true,
			data: [
				{
					id: "report-a",
					role: "employee",
					isFormer: false,
					user: { id: "person-a", name: "Ada", email: "ada@example.test", image: null },
					timeBalance: null,
					team: null,
				},
			],
		});
		const page = render(await TeamDirectory({ searchParams: Promise.resolve({}) }));
		expect(screen.getByRole("link", { name: "Ada" })).toBeTruthy();
		seams.session.isPending = true;
		page.rerender(await TeamDirectory({ searchParams: Promise.resolve({}) }));
		expect(screen.queryByRole("link", { name: "Ada" })).toBeNull();
		expect(screen.getByRole("status", { name: "Loading team members" })).toBeTruthy();
	});

	it.each(["actor", "organization", "role", "pending"])(
		"withholds retained records when current %s changes",
		async (change) => {
			seams.managed.mockResolvedValue({
				success: true,
				data: [
					{
						id: "report-a",
						role: "employee",
						isFormer: false,
						user: { id: "person-a", name: "Ada", email: "ada@example.test", image: null },
						timeBalance: null,
						team: null,
					},
				],
			});
			const tree = await TeamDirectory({ searchParams: Promise.resolve({}) });
			const page = render(tree);
			expect(screen.getByRole("link", { name: "Ada" })).toBeTruthy();
			if (change === "actor") seams.context.userId = "actor-b";
			if (change === "organization") seams.context.activeOrganizationId = "org-b";
			if (change === "role") seams.context.role = "employee";
			if (change === "pending") seams.context.isLoading = true;
			page.rerender(await TeamDirectory({ searchParams: Promise.resolve({}) }));
			expect(screen.queryByRole("link", { name: "Ada" })).toBeNull();
			expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		},
	);

	it("does not retain records after a server authorization refusal", async () => {
		seams.managed.mockResolvedValueOnce({
			success: true,
			data: [
				{
					id: "report-a",
					role: "employee",
					isFormer: false,
					user: { id: "person-a", name: "Ada", email: "ada@example.test", image: null },
					timeBalance: null,
					team: null,
				},
			],
		});
		const page = render(await TeamDirectory({ searchParams: Promise.resolve({}) }));
		seams.managed.mockResolvedValue({
			success: false,
			code: "AuthorizationError",
			error: "Not permitted",
		});
		page.rerender(await TeamDirectory({ searchParams: Promise.resolve({}) }));
		expect(screen.queryByRole("link", { name: "Ada" })).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("prevents duplicate Retry while its transition is pending", async () => {
		let resolveRefresh: (() => void) | undefined;
		seams.refresh.mockImplementationOnce(
			() =>
				new Promise<void>((done) => {
					resolveRefresh = done;
				}),
		);
		render(await TeamDirectory({ searchParams: Promise.resolve({}) }));
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		const pending = screen.getByRole("button", { name: "Retrying…" });
		fireEvent.click(pending);
		await waitFor(() => expect(seams.refresh).toHaveBeenCalledOnce());
		await act(async () => resolveRefresh?.());
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});

	it("rechecks current scope after Activity reactivation", async () => {
		seams.managed.mockResolvedValue({
			success: true,
			data: [
				{
					id: "report-a",
					role: "employee",
					isFormer: false,
					user: { id: "person-a", name: "Ada", email: "ada@example.test", image: null },
					timeBalance: null,
					team: null,
				},
			],
		});
		const tree = await TeamDirectory({ searchParams: Promise.resolve({}) });
		const page = render(<Activity mode="visible">{tree}</Activity>);
		page.rerender(<Activity mode="hidden">{tree}</Activity>);
		seams.context.activeOrganizationId = "org-b";
		page.rerender(<Activity mode="visible">{tree}</Activity>);
		expect(screen.queryByRole("link", { name: "Ada" })).toBeNull();
	});

	it("withholds a late A read in B and through pending A return until a fresh arrival", async () => {
		const data = [
			{
				id: "report-a",
				role: "employee",
				isFormer: false,
				user: { id: "person-a", name: "Ada", email: "ada@example.test", image: null },
				timeBalance: null,
				team: null,
			},
		];
		let finish: ((result: unknown) => void) | undefined;
		seams.managed.mockImplementationOnce(
			() =>
				new Promise((done) => {
					finish = done;
				}),
		);
		const late = TeamDirectory({ searchParams: Promise.resolve({}) });
		await vi.waitFor(() => expect(seams.managed).toHaveBeenCalledOnce());
		seams.context.activeOrganizationId = "org-b";
		finish?.({ success: true, data });
		const tree = await late;
		const page = render(tree);
		expect(screen.queryByRole("link", { name: "Ada" })).toBeNull();
		seams.context.activeOrganizationId = "org-a";
		seams.context.isLoading = true;
		page.rerender(await TeamDirectory({ searchParams: Promise.resolve({}) }));
		expect(screen.queryByRole("link", { name: "Ada" })).toBeNull();
		seams.context.isLoading = false;
		seams.managed.mockResolvedValue({ success: true, data });
		page.rerender(await TeamDirectory({ searchParams: Promise.resolve({}) }));
		expect(screen.getByRole("link", { name: "Ada" })).toBeTruthy();
	});
});
