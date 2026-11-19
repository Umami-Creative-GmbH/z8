// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DrivingDetailsController } from "./driving-details-controller";

const seam = vi.hoisted(() => ({
	read: vi.fn(),
	session: {
		data: { user: { id: "actor-a" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	},
	organization: {
		role: "admin",
		employeeId: "admin",
		error: null,
		isLoading: false,
		refetch: vi.fn(),
	},
}));
vi.mock("./actions", () => ({ readTeamDrivingDetails: seam.read }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => seam.session }));
vi.mock("@/hooks/use-organization", () => ({ useOrganization: () => seam.organization }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_: string, fallback: string) => fallback }),
	useTolgee: () => ({ getLanguage: () => "en-GB" }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/components/providers/user-preferences-provider", () => ({ useTimeFormat: () => "24h" }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
	Link: ({ children, href, ...props }: React.ComponentProps<"a">) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
const ok = (name: string) => ({
	status: "ok",
	scope: "all",
	details: {
		teams: [],
		employees: [],
		filters: { teamId: null, employeeId: null },
		rows: [
			{
				workPeriodId: name,
				employeeId: name,
				name,
				teamName: null,
				former: false,
				workDay: "2026-09-07",
				startedAt: "2026-09-07T06:00:00Z",
				endedAt: "2026-09-07T14:00:00Z",
				startOffsetMinutes: 120,
				endOffsetMinutes: 120,
				missing: "vehicle",
			},
		],
		truncated: false,
	},
});
function deferred() {
	let resolve!: (value: ReturnType<typeof ok> | { status: "forbidden" }) => void;
	const promise = new Promise<ReturnType<typeof ok> | { status: "forbidden" }>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function view() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const node = (mode: "visible" | "hidden" = "visible") => (
		<QueryClientProvider client={client}>
			<Activity mode={mode}>
				<DrivingDetailsController filters={{ teamId: null, employeeId: null }} />
			</Activity>
		</QueryClientProvider>
	);
	const result = render(node());
	return {
		...result,
		client,
		update: (mode?: "visible" | "hidden") => result.rerender(node(mode)),
	};
}
beforeEach(() => {
	seam.read.mockReset();
	seam.session.data.user.id = "actor-a";
	seam.session.data.session.activeOrganizationId = "org-a";
	seam.session.isPending = false;
	seam.organization.role = "admin";
});
describe("driving details public read recovery", () => {
	it("announces failure, retries and recovers the real read result", async () => {
		seam.read.mockResolvedValueOnce({ status: "error" }).mockResolvedValueOnce(ok("Recovered Ada"));
		view();
		expect(await screen.findByRole("alert")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(await screen.findByText("Recovered Ada")).toBeTruthy();
	});
	it("retains records on rejected refresh, prevents duplicate Retry and hides them after refusal", async () => {
		const pending = deferred();
		seam.read
			.mockResolvedValueOnce(ok("Retained Ada"))
			.mockRejectedValueOnce(Error("transport"))
			.mockReturnValueOnce(pending.promise);
		const v = view();
		await screen.findByText("Retained Ada");
		await act(async () => {
			await v.client.invalidateQueries();
		});
		expect(screen.getByText("Retained Ada")).toBeTruthy();
		expect((await screen.findByRole("alert")).textContent).toContain("Previously loaded records");
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(screen.getByRole<HTMLButtonElement>("button", { name: "Retry" }).disabled).toBe(true),
		);
		expect(seam.read).toHaveBeenCalledTimes(3);
		await act(async () => pending.resolve({ status: "forbidden" }));
		await waitFor(() => expect(screen.queryByText("Retained Ada")).toBeNull());
		expect(screen.getByRole("alert").textContent).toContain("current scope");
	});
	it.each(["organization", "actor"])("retires a late read across %s A to B to A", async (kind) => {
		const old = deferred();
		seam.read
			.mockReturnValueOnce(old.promise)
			.mockResolvedValueOnce(ok("Scope B"))
			.mockResolvedValueOnce(ok("Fresh A"));
		const v = view();
		await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(1));
		if (kind === "actor") seam.session.data.user.id = "actor-b";
		else seam.session.data.session.activeOrganizationId = "org-b";
		v.update();
		await screen.findByText("Scope B");
		if (kind === "actor") seam.session.data.user.id = "actor-a";
		else seam.session.data.session.activeOrganizationId = "org-a";
		v.update();
		await screen.findByText("Fresh A");
		await act(async () => old.resolve(ok("Stale A")));
		expect(screen.queryByText("Stale A")).toBeNull();
		expect(screen.queryByText("Scope B")).toBeNull();
	});
	it("keeps a retained pending session, but rereads a changed role", async () => {
		seam.read
			.mockResolvedValueOnce(ok("Current Ada"))
			.mockResolvedValueOnce({ status: "forbidden" });
		const v = view();
		await screen.findByText("Current Ada");
		seam.session.isPending = true;
		v.update();
		expect(screen.getByText("Current Ada")).toBeTruthy();
		seam.organization.role = "employee";
		v.update();
		await screen.findByRole("alert");
		expect(screen.queryByText("Current Ada")).toBeNull();
	});
	it("retires hidden Activity transport and reads fresh evidence when shown", async () => {
		const old = deferred();
		seam.read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(ok("Visible Ada"));
		const v = view();
		await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(1));
		v.update("hidden");
		await act(async () => old.resolve(ok("Hidden Ada")));
		v.update("visible");
		expect(await screen.findByText("Visible Ada")).toBeTruthy();
		expect(screen.queryByText("Hidden Ada")).toBeNull();
	});
});
