// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { EmployeeFileWorkspace } from "./employee-file-workspace";

const boundary = vi.hoisted(() => ({
	scope: { userId: "officer", activeOrganizationId: "org" },
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: "officer" }, session: { activeOrganizationId: "org" } },
		isPending: false,
	}),
	authClient: { $store: { atoms: { session: { subscribe: () => () => {} } } } },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => boundary.scope,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, key: string) => String(params?.[key] ?? match)),
	}),
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));
const props = {
	readId: "completed-read",
	userId: "officer",
	organizationId: "org",
	employee: {
		id: "target",
		name: "Morgan Taylor",
		employeeNumber: "P-104",
		isActive: false,
	},
};
beforeEach(() => {
	boundary.scope = { userId: "officer", activeOrganizationId: "org" };
});

it("leads with the selected employee, former status and personnel number before the records", () => {
	render(
		<EmployeeFileWorkspace {...props}>
			<section>Permitted documents</section>
		</EmployeeFileWorkspace>,
	);
	expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Morgan Taylor");
	expect(screen.getByText("Former employee")).toBeTruthy();
	expect(screen.getByText("Personnel number: P-104")).toBeTruthy();
	expect(screen.getByRole("link", { name: "Personnel files" }).getAttribute("href")).toBe(
		"/personnel-files",
	);
});

it.each([
	{ userId: "other", activeOrganizationId: "org" },
	{ userId: "officer", activeOrganizationId: "other" },
])("removes prior employee identity and open tasks on display-scope change", (scope) => {
	const view = render(
		<EmployeeFileWorkspace {...props}>
			<button type="button">Open document task</button>
		</EmployeeFileWorkspace>,
	);
	boundary.scope = scope;
	view.rerender(
		<EmployeeFileWorkspace {...props}>
			<button type="button">Open document task</button>
		</EmployeeFileWorkspace>,
	);
	expect(screen.queryByText("Morgan Taylor")).toBeNull();
	expect(screen.queryByRole("button", { name: "Open document task" })).toBeNull();
});
