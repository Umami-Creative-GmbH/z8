// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { EmployeeFileWorkspace } from "./employee-file-workspace";

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
	readId: "completed-read-a",
	userId: "officer",
	organizationId: "org-a",
	employee: {
		id: "target-a",
		name: "Previously admitted employee A",
		employeeNumber: "P-17",
		isActive: true,
	},
};
const selected = (readId = props.readId, name = props.employee.name) => (
	<EmployeeFileWorkspace {...props} readId={readId} employee={{ ...props.employee, name }}>
		<button type="button">Document task for {name}</button>
	</EmployeeFileWorkspace>
);
beforeEach(() => {
	vi.clearAllMocks();
	boundary.listeners.clear();
	boundary.scope = { userId: "officer", activeOrganizationId: "org-a" };
	boundary.session = {
		data: { user: { id: "officer" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	};
});

it("keeps a safe heading while the selected employee's display scope differs", () => {
	const view = render(selected());
	boundary.scope.activeOrganizationId = "org-b";
	view.rerender(selected());
	expect(screen.queryByText(props.employee.name)).toBeNull();
	expect(screen.queryByRole("button", { name: /Document task/ })).toBeNull();
	expect(screen.getByRole("heading", { level: 1, name: "Personnel file" })).toBeTruthy();
});

it.each(["organization", "account"])(
	"does not revive the completed %s read or its task after identity returns",
	(change) => {
		const view = render(selected());
		if (change === "organization") boundary.scope.activeOrganizationId = "org-b";
		else boundary.scope.userId = "another-officer";
		view.rerender(selected());
		boundary.scope = { userId: "officer", activeOrganizationId: "org-a" };
		view.rerender(selected());
		expect(screen.queryByText(props.employee.name)).toBeNull();
		expect(screen.queryByRole("button", { name: /Document task/ })).toBeNull();
	},
);

it("retires previously displayed identity and tasks across pending session proof", () => {
	const view = render(selected());
	boundary.session.isPending = true;
	view.rerender(selected());
	expect(screen.queryByText(props.employee.name)).toBeNull();
	expect(screen.queryByRole("button", { name: /Document task/ })).toBeNull();
	expect(screen.getByRole("status")).toBeTruthy();
	boundary.session.isPending = false;
	view.rerender(selected());
	expect(screen.queryByText(props.employee.name)).toBeNull();
});

it("refreshes locally and accepts a new admitted server read after retirement", () => {
	const view = render(selected());
	boundary.scope.activeOrganizationId = "org-b";
	view.rerender(selected());
	boundary.scope.activeOrganizationId = "org-a";
	view.rerender(selected());
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(boundary.refresh).toHaveBeenCalledOnce();
	expect(screen.queryByText(props.employee.name)).toBeNull();
	view.rerender(selected("fresh-read", "Fresh admitted employee"));
	expect(screen.getByRole("heading", { level: 1, name: "Fresh admitted employee" })).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Document task for Fresh admitted employee" }),
	).toBeTruthy();
	expect(screen.queryByText(props.employee.name)).toBeNull();
});

it("allows initial session hydration before the read has ever been displayed", () => {
	boundary.session.isPending = true;
	const view = render(selected());
	expect(screen.queryByText(props.employee.name)).toBeNull();
	boundary.session.isPending = false;
	view.rerender(selected());
	expect(screen.getByRole("heading", { level: 1, name: props.employee.name })).toBeTruthy();
});

it("observes an account round trip emitted within one React turn", () => {
	render(selected());
	act(() => {
		for (const id of ["another-officer", "officer"]) {
			for (const listener of boundary.listeners)
				listener({
					data: { user: { id }, session: { activeOrganizationId: "org-a" } },
					isPending: false,
				});
		}
	});
	expect(screen.queryByText(props.employee.name)).toBeNull();
	expect(screen.queryByRole("button", { name: /Document task/ })).toBeNull();
});

it("permits a passive same-scope Activity return without claiming a fresh read", () => {
	const page = (mode: "visible" | "hidden") => <Activity mode={mode}>{selected()}</Activity>;
	const view = render(page("visible"));
	view.rerender(page("hidden"));
	expect(screen.queryByRole("button", { name: /Document task/ })).toBeNull();
	view.rerender(page("visible"));
	expect(screen.getByRole("heading", { level: 1, name: props.employee.name })).toBeTruthy();
});
