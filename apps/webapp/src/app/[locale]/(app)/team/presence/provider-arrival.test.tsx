// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocationSelection } from "@/app/[locale]/(app)/team/presence/location-selection";
import { HeaderRefreshButton } from "@/components/header-refresh-button";
import {
	OrganizationContextProvider,
	useOrganization,
} from "@/components/providers/organization-context-provider";
import { ViewRefreshProvider } from "@/components/providers/view-refresh-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

// Only external session/navigation/translation/fetch/server-action transports are replaced.
// QueryClient, provider, published context hook, refresh owner/button and selection are real.
const seam = vi.hoisted(() => ({
	fetch: vi.fn(),
	read: vi.fn(),
	refresh: vi.fn(),
	replace: vi.fn(),
	session: {
		data: { user: { id: "reader-a" }, session: { id: "session-a", activeOrganizationId: "org-a" } },
		isPending: false,
	},
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => seam.session }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: seam.refresh }) }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ replace: seam.replace }),
	Link: (props: ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("@/app/[locale]/(app)/team/presence/selection-actions", () => ({
	readPresenceLocations: seam.read,
}));

function display(
	employeeId: string | null = "employee-a",
	role: "admin" | "manager" | "employee" = "admin",
) {
	return {
		userId: "reader-a",
		organizationId: "org-a",
		employee: employeeId ? { employeeId, organizationId: "org-a", role } : null,
		organizationSettings: null,
		updatedAt: Date.now(),
	};
}
function response(
	employeeId: string | null = "employee-a",
	role: "admin" | "manager" | "employee" = "admin",
) {
	const c = display(employeeId, role);
	return new Response(
		JSON.stringify({
			user: { id: c.userId },
			session: { activeOrganizationId: c.organizationId },
			employee: c.employee,
			organizationSettings: null,
		}),
		{ status: 200 },
	);
}
function locations(name: string) {
	return {
		status: "ok",
		userId: "reader-a",
		organizationId: "org-a",
		locations: [{ id: "berlin", name }],
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
let client: QueryClient;
function Observe() {
	const context = useOrganization();
	return (
		<output aria-label="Canonical display">
			{JSON.stringify({ employeeId: context.employeeId, role: context.role, error: context.error })}
		</output>
	);
}
function page(bootstrap = true) {
	return (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={bootstrap ? display() : null}>
				<ViewRefreshProvider>
					<TooltipProvider>
						<HeaderRefreshButton />
						<Observe />
						<LocationSelection />
					</TooltipProvider>
				</ViewRefreshProvider>
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
}
beforeEach(() => {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	seam.session.data.session.id = "session-a";
	seam.session.isPending = false;
	seam.read.mockReset();
	seam.fetch.mockReset().mockImplementation(() => Promise.resolve(response()));
	seam.refresh.mockReset();
	seam.replace.mockReset();
	vi.stubGlobal("fetch", seam.fetch);
});
afterEach(() => {
	cleanup();
	client.clear();
	vi.unstubAllGlobals();
});

it("01 control: actual local Retry recovers independent location failure; header recovers initial canonical context failure", async () => {
	seam.fetch.mockResolvedValueOnce(
		new Response(JSON.stringify({ message: "Display unavailable" }), { status: 503 }),
	);
	seam.read.mockResolvedValueOnce({ status: "error" });
	render(page(false));
	await screen.findByRole("alert");
	await waitFor(() =>
		expect(screen.getByLabelText("Canonical display").textContent).toContain("Display unavailable"),
	);
	expect(screen.queryByText("Your organization has no active locations yet.")).toBeNull();
	seam.read.mockResolvedValueOnce(locations("Recovered via canonical server action"));
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByRole("link", { name: /Recovered via canonical server action/ });
	seam.read.mockResolvedValue(locations("Header recovery"));
	fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
	await screen.findByRole("link", { name: /Header recovery/ });
	await waitFor(() =>
		expect(screen.getByLabelText("Canonical display").textContent).toContain('"error":null'),
	);
	expect(seam.fetch).toHaveBeenCalledTimes(2);
	expect(seam.refresh).toHaveBeenCalledTimes(1);
	// Header starts a read while the context retry is settling. The accepted new
	// display identity retires that owner and requires its own fresh server read.
	expect(seam.read).toHaveBeenCalledTimes(4);
});

it("02 control: replacing the raw session retires an old location response for the same actor and organization", async () => {
	const old = deferred<ReturnType<typeof locations>>();
	seam.read.mockReturnValueOnce(old.promise);
	const view = render(page());
	seam.session.data.session.id = "session-b";
	seam.read.mockResolvedValueOnce(locations("Fresh session result"));
	view.rerender(page());
	await screen.findByRole("link", { name: /Fresh session result/ });
	await act(async () => old.resolve(locations("Retired session result")));
	expect(screen.queryByRole("link", { name: /Retired session result/ })).toBeNull();
	expect(seam.read).toHaveBeenCalledTimes(2);
});

it.each([
	{ name: "employee", employeeId: "replacement-employee", role: "admin" as const },
	{ name: "role", employeeId: "employee-a", role: "employee" as const },
	{ name: "employee and role", employeeId: "replacement-employee", role: "employee" as const },
])(
	"a canonical $name arrival retires the queued old read even when raw session IDs stay the same",
	async ({ employeeId, role }) => {
		const old = deferred<ReturnType<typeof locations>>();
		seam.read.mockReturnValueOnce(old.promise);
		// A fresh server read may legitimately authorize this identity; no frontend role denial is required.
		seam.read.mockResolvedValue(locations("Fresh server-authorized arrival"));
		render(page());
		await waitFor(() =>
			expect(screen.getByLabelText("Canonical display").textContent).toContain(
				'"employeeId":"employee-a"',
			),
		);
		expect(seam.read).toHaveBeenCalledTimes(1);
		seam.fetch.mockResolvedValueOnce(response(employeeId, role));
		await act(async () => {
			await client.invalidateQueries();
		});
		await waitFor(() =>
			expect(screen.getByLabelText("Canonical display").textContent).toContain(
				`"employeeId":"${employeeId}"`,
			),
		);
		expect(screen.getByLabelText("Canonical display").textContent).toContain(`"role":"${role}"`);
		expect(seam.session.data).toEqual({
			user: { id: "reader-a" },
			session: { id: "session-a", activeOrganizationId: "org-a" },
		});
		await act(async () => old.resolve(locations("RETIRED canonical arrival result")));
		const stale = screen.queryByRole("link", { name: /RETIRED canonical arrival result/ });
		expect(
			stale,
			"An old response must not satisfy a retired canonical identity arrival",
		).toBeNull();
		expect(
			await screen.findByRole("link", { name: /Fresh server-authorized arrival/ }),
		).toBeTruthy();
		expect(seam.read).toHaveBeenCalledTimes(2);
	},
);

it("continues using fresh server admission when the approved administrator has no employee", async () => {
	seam.read.mockResolvedValue(locations("Server-authorized owner location"));
	render(page());
	await screen.findByRole("link", { name: /Server-authorized owner location/ });
	seam.fetch.mockResolvedValueOnce(response(null));
	await act(async () => {
		await client.invalidateQueries();
	});
	await waitFor(() =>
		expect(screen.getByLabelText("Canonical display").textContent).toContain('"employeeId":null'),
	);
	expect(
		await screen.findByRole("link", { name: /Server-authorized owner location/ }),
	).toBeTruthy();
	expect(seam.read).toHaveBeenCalledTimes(2);
	expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
});

it("does not revive a pending old read when the canonical display returns to its earlier employee and role", async () => {
	const old = deferred<ReturnType<typeof locations>>();
	seam.read
		.mockReturnValueOnce(old.promise)
		.mockResolvedValue(locations("Fresh intermediate location"));
	render(page());
	seam.fetch.mockResolvedValueOnce(response("replacement-employee", "manager"));
	await act(async () => {
		await client.invalidateQueries();
	});
	await screen.findByRole("link", { name: /Fresh intermediate location/ });
	seam.read.mockResolvedValue(locations("Fresh returning location"));
	seam.fetch.mockResolvedValueOnce(response());
	await act(async () => {
		await client.invalidateQueries();
	});
	await screen.findByRole("link", { name: /Fresh returning location/ });
	await act(async () => old.resolve(locations("Retired first-arrival location")));
	expect(
		screen.queryByRole("link", {
			name: /Retired first-arrival location|Fresh intermediate location/,
		}),
	).toBeNull();
	expect(seam.read).toHaveBeenCalledTimes(3);
});
