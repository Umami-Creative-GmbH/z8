/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { Temporal } from "temporal-polyfill";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationsInbox } from "./notifications-inbox";

const actor = vi.hoisted(() => ({
	user: "a",
	org: "a",
	pending: false,
	push: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: {
			user: { id: actor.user },
			session: { activeOrganizationId: actor.org },
		},
		isPending: actor.pending,
	}),
}));
vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ organizationId: actor.org, userId: actor.user }),
}));
vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, key) =>
				String(values?.[key] ?? match),
			),
	}),
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: ComponentProps<"a">) => (
		<a href={String(href)} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({ push: actor.push }),
}));

let rows: { id: string; title: string; isRead: boolean; createdAt: string }[];
let failRead = false;
let readStatus = 503;
let failId = "";
let release: (() => void) | undefined;
let hold = false;
const writes: string[] = [];
function mount() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<NotificationsInbox />
		</QueryClientProvider>,
	);
}
beforeEach(() => {
	actor.user = "a";
	actor.org = "a";
	actor.pending = false;
	actor.push.mockReset();
	failRead = false;
	readStatus = 503;
	failId = "";
	hold = false;
	writes.length = 0;
	rows = ["Alpha", "Beta", "Gamma"].map((title, i) => ({
		id: title,
		title,
		isRead: i === 2,
		createdAt: "2026-11-15T10:00:00Z",
	}));
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, options?: RequestInit) => {
			if (url.endsWith("/count"))
				return Response.json({ count: rows.filter((n) => !n.isRead).length });
			if (!options?.method)
				return failRead
					? Response.json({ error: "Offline" }, { status: readStatus })
					: Response.json({
							notifications: rows.map((n) => ({
								...n,
								message: `${n.title} detail`,
								type: "password_changed",
								actionUrl: "/settings/security",
								timeAgo: "now",
							})),
							total: rows.length,
							hasMore: false,
						});
			const { id } = JSON.parse(String(options.body));
			writes.push(id);
			if (hold)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			if (id === failId)
				return Response.json({ error: "Refused" }, { status: 404 });
			if (options.method === "DELETE") rows = rows.filter((n) => n.id !== id);
			else rows = rows.map((n) => (n.id === id ? { ...n, isRead: true } : n));
			return Response.json({ success: true });
		}),
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it("groups arrival instants in the explicit local zone across the DST boundary", async () => {
	vi.spyOn(Temporal.Now, "timeZoneId").mockReturnValue("America/New_York");
	vi.spyOn(Temporal.Now, "plainDateISO").mockReturnValue(
		Temporal.PlainDate.from("2026-11-01"),
	);
	rows[0].createdAt = "2026-11-01T04:30:00Z";
	rows[1].createdAt = "2026-11-01T03:30:00Z";
	rows[2].createdAt = "2026-10-30T12:00:00Z";
	mount();
	await screen.findByRole("checkbox", { name: "Select Alpha" });
	expect(
		within(screen.getByRole("region", { name: "Today" })).getByRole(
			"checkbox",
			{ name: "Select Alpha" },
		),
	).toBeTruthy();
	expect(
		within(screen.getByRole("region", { name: "Yesterday" })).getByRole(
			"checkbox",
			{ name: "Select Beta" },
		),
	).toBeTruthy();
	expect(
		within(screen.getByRole("region", { name: "Earlier" })).getByRole(
			"checkbox",
			{ name: "Select Gamma" },
		),
	).toBeTruthy();
});

it("reports partial visible deletion and retains failed items for retry", async () => {
	mount();
	await screen.findByRole("checkbox", { name: "Select Alpha" });
	fireEvent.click(
		screen.getByRole("checkbox", { name: "Select all visible notifications" }),
	);
	fireEvent.change(
		screen.getByRole("textbox", { name: "Search notifications" }),
		{ target: { value: "Alpha" } },
	);
	await waitFor(() =>
		expect(screen.queryByRole("checkbox", { name: "Select Beta" })).toBeNull(),
	);
	fireEvent.click(
		screen.getAllByRole("button", { name: "Delete", exact: true })[0],
	);
	await waitFor(() => expect(writes).toEqual(["Alpha"]));
	fireEvent.change(
		screen.getByRole("textbox", { name: "Search notifications" }),
		{ target: { value: "" } },
	);
	await screen.findByRole("checkbox", { name: "Select Beta" });
	fireEvent.click(
		screen.getByRole("checkbox", { name: "Select all visible notifications" }),
	);
	failId = "Beta";
	fireEvent.click(
		screen.getAllByRole("button", { name: "Delete", exact: true })[0],
	);
	expect(
		await screen.findByText(
			"1 deleted; 1 failed. Retry the remaining selection.",
		),
	).toBeTruthy();
	expect(
		screen
			.getByRole("checkbox", { name: "Select Beta" })
			.getAttribute("aria-checked"),
	).toBe("true");
	failId = "";
	fireEvent.click(
		screen.getAllByRole("button", { name: "Delete", exact: true })[0],
	);
	expect(await screen.findByText("Deleted 1 notifications")).toBeTruthy();
});

it("keeps failed loading distinct from all clear and recovers the actual reader", async () => {
	failRead = true;
	mount();
	await screen.findByText("Could not load notifications");
	expect(screen.queryByText("No notifications")).toBeNull();
	failRead = false;
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByRole("checkbox", { name: "Select Alpha" });
	fireEvent.change(
		screen.getByRole("textbox", { name: "Search notifications" }),
		{ target: { value: "nothing" } },
	);
	expect(await screen.findByText("No matching notifications")).toBeTruthy();
});

it("marks only selected visible unread records and opens the stored destination", async () => {
	mount();
	await screen.findByRole("checkbox", { name: "Select Alpha" });
	fireEvent.click(
		screen.getByRole("checkbox", { name: "Select all visible notifications" }),
	);
	fireEvent.click(screen.getByRole("button", { name: "Unread", exact: true }));
	fireEvent.click(
		screen.getByRole("button", { name: "Mark read", exact: true }),
	);
	expect(
		await screen.findByText("Marked 2 notifications as read"),
	).toBeTruthy();
	expect(writes.sort()).toEqual(["Alpha", "Beta"]);
	expect(await screen.findByText("No unread notifications")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Read", exact: true }));
	fireEvent.click(await screen.findByRole("button", { name: /Gamma detail/ }));
	expect(actor.push).toHaveBeenCalledWith("/settings/security");
});

it.each(["org", "user"] as const)(
	"discards selected targets and late outcomes across a %s round trip",
	async (kind) => {
		const view = mount();
		await screen.findByRole("checkbox", { name: "Select Alpha" });
		fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
		hold = true;
		fireEvent.click(
			screen.getAllByRole("button", { name: "Delete", exact: true })[0],
		);
		await waitFor(() => expect(release).toBeTypeOf("function"));
		actor[kind] = "b";
		view.rerender(
			<QueryClientProvider
				client={
					new QueryClient({ defaultOptions: { queries: { retry: false } } })
				}
			>
				<NotificationsInbox />
			</QueryClientProvider>,
		);
		expect(
			screen.queryByRole("group", { name: "Selected notifications" }),
		).toBeNull();
		actor[kind] = "a";
		view.rerender(
			<QueryClientProvider
				client={
					new QueryClient({ defaultOptions: { queries: { retry: false } } })
				}
			>
				<NotificationsInbox />
			</QueryClientProvider>,
		);
		await act(async () => {
			release?.();
		});
		expect(screen.queryByText("Deleted 1 notifications")).toBeNull();
		expect(
			screen.queryByRole("group", { name: "Selected notifications" }),
		).toBeNull();
	},
);

it("retains the search and cached rows through failed refresh and Retry", async () => {
	mount();
	await screen.findByRole("checkbox", { name: "Select Alpha" });
	fireEvent.change(
		screen.getByRole("textbox", { name: "Search notifications" }),
		{ target: { value: "Alpha" } },
	);
	failRead = true;
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByText("Could not load notifications");
	expect(screen.getByRole("checkbox", { name: "Select Alpha" })).toBeTruthy();
	failRead = false;
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() =>
		expect(screen.queryByText("Could not load notifications")).toBeNull(),
	);
	expect(
		(
			screen.getByRole("textbox", {
				name: "Search notifications",
			}) as HTMLInputElement
		).value,
	).toBe("Alpha");
});

it("withdraws cached action targets when authority is refused on refresh", async () => {
	mount();
	await screen.findByRole("checkbox", { name: "Select Alpha" });
	failRead = true;
	readStatus = 403;
	fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
	await screen.findByText("Could not load notifications");
	expect(screen.queryByRole("checkbox", { name: "Select Alpha" })).toBeNull();
});
