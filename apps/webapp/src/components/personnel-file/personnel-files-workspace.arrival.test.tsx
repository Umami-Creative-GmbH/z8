// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { PersonnelFilesWorkspace } from "./personnel-files-workspace";

const boundary = vi.hoisted(() => ({
	refresh: vi.fn(),
	listeners: new Set<
		(value: {
			data: { user: { id: string }; session: { activeOrganizationId: string } };
			isPending: boolean;
		}) => void
	>(),
	scope: { userId: "officer", activeOrganizationId: "org-a" },
	session: {
		data: { user: { id: "officer" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	},
}));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => boundary.scope,
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => boundary.session,
	authClient: {
		$store: {
			atoms: {
				session: {
					subscribe: (listener: (value: typeof boundary.session) => void) => {
						boundary.listeners.add(listener);
						return () => boundary.listeners.delete(listener);
					},
				},
			},
		},
	},
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: boundary.refresh }) }));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));
const props = {
	readId: "server-read-a",
	userId: "officer",
	organizationId: "org-a",
	employees: [{ id: "employee-a", name: "Retired A record", employeeNumber: null, isActive: true }],
	capability: {
		payslipBatches: false,
		documentRequests: true,
		sickLeave: false,
		officerSettings: false,
	},
	attention: <a href="/personnel-files/employee-a?category=certificate">Retired A certificate</a>,
};
beforeEach(() => {
	vi.clearAllMocks();
	boundary.listeners.clear();
	boundary.scope = { userId: "officer", activeOrganizationId: "org-a" };
	boundary.session = {
		data: { user: { id: "officer" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	};
});

it("retains a safe task heading while an old organization snapshot is refused", () => {
	const view = render(<PersonnelFilesWorkspace {...props} />);
	boundary.scope.activeOrganizationId = "org-b";
	view.rerender(<PersonnelFilesWorkspace {...props} />);
	expect(screen.queryByText("Retired A record")).toBeNull();
	expect(screen.getByRole("heading", { level: 1, name: "Personnel Files" })).toBeTruthy();
});

it.each(["organization", "account"])(
	"does not revive a retired %s snapshot when the original identity returns",
	(change) => {
		const view = render(<PersonnelFilesWorkspace {...props} />);
		if (change === "organization") boundary.scope.activeOrganizationId = "org-b";
		else boundary.scope.userId = "another-officer";
		view.rerender(<PersonnelFilesWorkspace {...props} />);
		boundary.scope = { userId: "officer", activeOrganizationId: "org-a" };
		view.rerender(<PersonnelFilesWorkspace {...props} />);
		expect(screen.queryByText("Retired A record")).toBeNull();
		expect(screen.queryByText("Retired A certificate")).toBeNull();
		expect(screen.getByRole("heading", { level: 1, name: "Personnel Files" })).toBeTruthy();
	},
);

it("does not present a retained snapshot as current while session proof is pending", () => {
	const view = render(<PersonnelFilesWorkspace {...props} />);
	boundary.session.isPending = true;
	view.rerender(<PersonnelFilesWorkspace {...props} />);
	expect(screen.queryByText("Retired A record")).toBeNull();
	expect(screen.getByRole("heading", { level: 1, name: "Personnel Files" })).toBeTruthy();
});

it("exercises actual Activity hide/show without substituting another component", async () => {
	const page = (mode: "visible" | "hidden") => (
		<Activity mode={mode}>
			<PersonnelFilesWorkspace {...props} />
		</Activity>
	);
	const view = render(page("visible"));
	view.rerender(page("hidden"));
	expect(screen.queryByRole("link", { name: "Retired A certificate" })).toBeNull();
	view.rerender(page("visible"));
	await act(async () => {});
	// Passive server snapshots may be retained on a same-scope Activity return;
	// this control makes no pending command or fresh-read claim.
	expect(screen.getByRole("heading", { level: 1, name: "Personnel Files" })).toBeTruthy();
});

it("requires a new server read after retirement, then shows fresh admitted data", () => {
	const view = render(<PersonnelFilesWorkspace {...props} />);
	boundary.scope.activeOrganizationId = "org-b";
	view.rerender(<PersonnelFilesWorkspace {...props} />);
	boundary.scope.activeOrganizationId = "org-a";
	view.rerender(<PersonnelFilesWorkspace {...props} />);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(boundary.refresh).toHaveBeenCalledOnce();
	view.rerender(
		<PersonnelFilesWorkspace
			{...props}
			readId="fresh-server-read"
			employees={[
				{ id: "fresh", name: "Fresh admitted record", employeeNumber: null, isActive: true },
			]}
			attention={<p>Fresh attention</p>}
		/>,
	);
	expect(screen.getByText("Fresh admitted record")).toBeTruthy();
	expect(screen.queryByText("Retired A record")).toBeNull();
	expect(screen.queryByText("Retired A certificate")).toBeNull();
});

it("permits first session hydration without reviving a previously displayed snapshot", () => {
	boundary.session.isPending = true;
	const view = render(<PersonnelFilesWorkspace {...props} />);
	expect(screen.queryByText("Retired A record")).toBeNull();
	boundary.session.isPending = false;
	view.rerender(<PersonnelFilesWorkspace {...props} />);
	expect(screen.getByText("Retired A record")).toBeTruthy();
});

it("observes an account round trip that the session atom emits within one React turn", () => {
	render(<PersonnelFilesWorkspace {...props} />);
	act(() => {
		for (const id of ["another-officer", "officer"]) {
			for (const listener of boundary.listeners)
				listener({
					data: { user: { id }, session: { activeOrganizationId: "org-a" } },
					isPending: false,
				});
		}
	});
	expect(screen.queryByText("Retired A record")).toBeNull();
	expect(screen.getByRole("heading", { level: 1, name: "Personnel Files" })).toBeTruthy();
});
