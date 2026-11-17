/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render as renderUI, screen } from "@testing-library/react";
import { Activity, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";

const boundary = vi.hoisted(() => ({
	userId: "reader-a",
	organizationId: "org-a",
	isPending: false,
	sessionId: "session-a",
	updatedAt: 0,
	read: vi.fn(),
	refresh: undefined as undefined | (() => unknown),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: boundary.userId
			? {
					user: { id: boundary.userId },
					session: { id: boundary.sessionId, activeOrganizationId: boundary.organizationId },
				}
			: null,
		isPending: boundary.isPending,
	}),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/navigation", () => ({
	Link: (props: React.ComponentProps<"a">) => <a {...props} />,
	useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("./selection-actions", () => ({ readPresenceLocations: boundary.read }));
vi.mock("@/components/providers/view-refresh-provider", () => ({
	useViewRefresh: (handler: () => unknown) => {
		boundary.refresh = handler;
	},
}));

import { LocationSelection } from "./location-selection";

let client: QueryClient;
function Providers({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider
				initialContext={{
					userId: boundary.userId,
					organizationId: boundary.organizationId,
					employee: {
						employeeId: "current-employee",
						organizationId: boundary.organizationId,
						role: "admin",
					},
					organizationSettings: null,
					updatedAt: boundary.updatedAt,
				}}
			>
				{children}
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
}
function render(ui: ReactElement) {
	return renderUI(ui, { wrapper: Providers });
}

function available(name = "Berlin office", organizationId = "org-a", userId = "reader-a") {
	return { status: "ok", userId, organizationId, locations: [{ id: "berlin", name }] };
}

beforeEach(() => {
	boundary.updatedAt = Date.now();
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	boundary.userId = "reader-a";
	boundary.organizationId = "org-a";
	boundary.isPending = false;
	boundary.sessionId = "session-a";
	boundary.read.mockReset().mockResolvedValue(available());
});
afterEach(() => {
	cleanup();
	client.clear();
});

it("rejects late data from a replaced session for the same actor and organization", async () => {
	let finish!: (result: unknown) => void;
	boundary.read.mockImplementationOnce(
		() =>
			new Promise((done) => {
				finish = done;
			}),
	);
	const view = render(<LocationSelection />);
	boundary.sessionId = "session-b";
	boundary.read.mockResolvedValueOnce(available("New session location"));
	view.rerender(<LocationSelection />);
	await screen.findByRole("link", { name: /New session location/ });
	await act(async () => finish(available("Old session location")));
	expect(screen.queryByRole("link", { name: /Old session location/ })).toBeNull();
});

it("leads with location selection and opens the existing presence destination", async () => {
	render(<LocationSelection />);
	expect(screen.getByRole("heading", { level: 1, name: "Who is in" })).toBeTruthy();
	expect((await screen.findByRole("link", { name: /Berlin office/ })).getAttribute("href")).toBe(
		"/team/presence/berlin",
	);
});

it("distinguishes no active locations from an unavailable read and retries locally", async () => {
	boundary.read.mockResolvedValueOnce({ status: "error" });
	render(<LocationSelection />);
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(screen.queryByText("Your organization has no active locations yet.")).toBeNull();
	boundary.read.mockResolvedValueOnce({ ...available(), locations: [] });
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByText("Your organization has no active locations yet.")).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
});

it("retains loaded locations after a rejected refresh and prevents duplicate retry reads", async () => {
	render(<LocationSelection />);
	await screen.findByRole("link", { name: /Berlin office/ });
	boundary.read.mockRejectedValueOnce(new Error("network"));
	await act(async () => {
		await expect(boundary.refresh?.()).rejects.toThrow();
	});
	expect(screen.getByRole("link", { name: /Berlin office/ })).toBeTruthy();
	expect(screen.getByRole("alert").textContent).toContain("last loaded");
	let resolve!: (result: unknown) => void;
	boundary.read.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(boundary.read).toHaveBeenCalledTimes(3);
	expect((screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement).disabled).toBe(true);
	await act(async () => resolve(available("Fresh location")));
	expect(await screen.findByRole("link", { name: /Fresh location/ })).toBeTruthy();
});

it.each(["organization", "actor"])("rejects late %s A→B→A responses", async (kind) => {
	let finishOld!: (result: unknown) => void;
	boundary.read.mockImplementationOnce(
		() =>
			new Promise((done) => {
				finishOld = done;
			}),
	);
	const view = render(<LocationSelection />);
	if (kind === "organization") boundary.organizationId = "org-b";
	else boundary.userId = "reader-b";
	boundary.read.mockResolvedValueOnce(
		available("B location", boundary.organizationId, boundary.userId),
	);
	view.rerender(<LocationSelection />);
	await screen.findByRole("link", { name: /B location/ });
	boundary.organizationId = "org-a";
	boundary.userId = "reader-a";
	boundary.read.mockResolvedValueOnce(available("Current A location"));
	view.rerender(<LocationSelection />);
	await screen.findByRole("link", { name: /Current A location/ });
	await act(async () => finishOld(available("Stale A location")));
	expect(screen.queryByRole("link", { name: /Stale A location|B location/ })).toBeNull();
});

it("hides retained data during pending session validation and after sign-out", async () => {
	const view = render(<LocationSelection />);
	await screen.findByRole("link", { name: /Berlin office/ });
	boundary.isPending = true;
	view.rerender(<LocationSelection />);
	expect(screen.queryByRole("link", { name: /Berlin office/ })).toBeNull();
	expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
	boundary.isPending = false;
	boundary.userId = "";
	view.rerender(<LocationSelection />);
	expect(screen.queryByRole("link", { name: /Berlin office/ })).toBeNull();
	expect(screen.getByRole("link", { name: "Back to dashboard" })).toBeTruthy();
});

it("discards data on refused refresh and keeps the original home destination", async () => {
	render(<LocationSelection />);
	await screen.findByRole("link", { name: /Berlin office/ });
	boundary.read.mockResolvedValueOnce({ status: "forbidden" });
	await act(async () => {
		await expect(boundary.refresh?.()).rejects.toThrow();
	});
	expect(screen.queryByRole("link", { name: /Berlin office/ })).toBeNull();
	expect(screen.getByRole("link", { name: "Back to dashboard" }).getAttribute("href")).toBe("/");
});

it("revalidates after Activity hides the route and discards its old pending read", async () => {
	let finishOld!: (result: unknown) => void;
	boundary.read.mockImplementationOnce(
		() =>
			new Promise((done) => {
				finishOld = done;
			}),
	);
	const view = render(
		<Activity mode="visible">
			<LocationSelection />
		</Activity>,
	);
	view.rerender(
		<Activity mode="hidden">
			<LocationSelection />
		</Activity>,
	);
	boundary.read.mockResolvedValueOnce(available("Revalidated location"));
	view.rerender(
		<Activity mode="visible">
			<LocationSelection />
		</Activity>,
	);
	await screen.findByRole("link", { name: /Revalidated location/ });
	await act(async () => finishOld(available("Old hidden location")));
	expect(screen.queryByRole("link", { name: /Old hidden location/ })).toBeNull();
});

it("refuses a successful result for a different scope rather than retaining its links", async () => {
	boundary.read.mockResolvedValueOnce(available("Foreign office", "org-b"));
	render(<LocationSelection />);
	await screen.findByRole("alert");
	expect(screen.queryByRole("link", { name: /Foreign office/ })).toBeNull();
});
