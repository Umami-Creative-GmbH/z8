/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query/keys";
import { render } from "@/test/render-with-translations";
import { NotificationBell } from "./notification-bell";

const identity = vi.hoisted(() => ({
	userId: "user-a",
	organizationId: "org-a",
	contextOrganizationId: "org-a",
	sessionPending: false,
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ organizationId: identity.contextOrganizationId }),
}));

vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: identity.userId
			? {
					user: { id: identity.userId },
					session: { activeOrganizationId: identity.organizationId },
				}
			: null,
		isPending: identity.sessionPending,
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, ...props }: ComponentProps<"a">) => (
		<a href={String(href)} {...props} />
	),
	useRouter: () => ({ push: vi.fn() }),
}));

describe("NotificationBell caller", () => {
	let client: QueryClient;
	let requests: string[];
	let requestHeaders: Headers[];

	beforeEach(() => {
		identity.userId = "user-a";
		identity.organizationId = "org-a";
		identity.contextOrganizationId = "org-a";
		identity.sessionPending = false;
		requests = [];
		requestHeaders = [];
		client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, options?: RequestInit) => {
				requests.push(url);
				requestHeaders.push(new Headers(options?.headers));
				return Response.json(
					url.includes("/count")
						? {
								count:
									identity.organizationId === "org-b"
										? 9
										: identity.userId === "user-b"
											? 7
											: 3,
							}
						: { notifications: [], total: 0, hasMore: false, unreadCount: 3 },
				);
			}),
		);
	});

	afterEach(() => {
		cleanup();
		client.clear();
		vi.unstubAllGlobals();
	});

	it("shows the closed badge using only the unread-count request", async () => {
		render(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		await screen.findAllByLabelText("Notifications (3 unread)");
		await waitFor(() =>
			expect(
				requests.filter((url) => url === "/api/notifications/count"),
			).toHaveLength(1),
		);
		expect(
			requests.filter((url) => url.startsWith("/api/notifications?")),
		).toHaveLength(0);
		expect(requestHeaders[0].get("x-z8-notification-user")).toBe("user-a");
		expect(requestHeaders[0].get("x-z8-notification-organization")).toBe(
			"org-a",
		);
	});

	it("replaces a previous user's badge when identity changes in the same organization", async () => {
		const view = render(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		await screen.findAllByLabelText("Notifications (3 unread)");
		identity.userId = "user-b";
		view.rerender(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		expect(screen.queryAllByLabelText("Notifications (3 unread)")).toHaveLength(
			0,
		);
		await screen.findAllByLabelText("Notifications (7 unread)");
		expect(
			requests.filter((url) => url === "/api/notifications/count"),
		).toHaveLength(2);
	});

	it("hides the previous organization's badge while display context catches up to the active session", async () => {
		const view = render(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		await screen.findAllByLabelText("Notifications (3 unread)");
		identity.organizationId = "org-b";
		view.rerender(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		expect(screen.queryAllByLabelText("Notifications (3 unread)")).toHaveLength(
			0,
		);
		expect(requests).toHaveLength(1);
		identity.contextOrganizationId = "org-b";
		view.rerender(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		await screen.findAllByLabelText("Notifications (9 unread)");
		expect(requestHeaders[1].get("x-z8-notification-organization")).toBe(
			"org-b",
		);
	});

	it("clears the badge on sign-out without fetching an unauthenticated inbox", async () => {
		const view = render(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		await screen.findAllByLabelText("Notifications (3 unread)");
		identity.userId = "";
		view.rerender(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		expect(screen.queryAllByLabelText("Notifications (3 unread)")).toHaveLength(
			0,
		);
		expect(requests).toHaveLength(1);
	});

	it.each([
		["mobile", 0],
		["desktop", 1],
	] as const)(
		"loads the list only after the %s control opens and reuses a fresh list",
		async (_surface, index) => {
			const user = userEvent.setup();
			render(
				<QueryClientProvider client={client}>
					<NotificationBell />
				</QueryClientProvider>,
			);
			const triggers = await screen.findAllByLabelText(
				"Notifications (3 unread)",
			);
			await user.click(triggers[index]);
			await screen.findByText("No notifications");
			expect(
				requests.filter((url) => url.startsWith("/api/notifications?")),
			).toHaveLength(1);
			await user.keyboard("{Escape}");
			await waitFor(() =>
				expect(screen.queryByText("No notifications")).toBeNull(),
			);
			await user.click(
				(await screen.findAllByLabelText("Notifications (3 unread)"))[index],
			);
			await screen.findByText("No notifications");
			expect(
				requests.filter((url) => url.startsWith("/api/notifications?")),
			).toHaveLength(1);
			expect(
				requests.filter((url) => url === "/api/notifications/count"),
			).toHaveLength(1);
		},
	);

	it.each(["Mark as read", "Mark all read", "Delete", "Delete all"])(
		"refreshes the visible list and badge after %s without invalidating other query families",
		async (action) => {
			let isRead = false;
			let deleted = false;
			const methods: string[] = [];
			const otherInbox = [
				...queryKeys.notifications.inbox("user-b", "org-b"),
				"unread-count",
			];
			const preferences = queryKeys.notifications.preferences("org-a");
			client.setQueryData(otherInbox, { count: 11 });
			client.setQueryData(preferences, { enabled: true });
			vi.stubGlobal(
				"fetch",
				vi.fn(async (url: string, options?: RequestInit) => {
					requests.push(url);
					methods.push(options?.method ?? "GET");
					const headers = new Headers(options?.headers);
					expect(headers.get("x-z8-notification-user")).toBe("user-a");
					expect(headers.get("x-z8-notification-organization")).toBe("org-a");
					if (options?.method === "PATCH") {
						isRead = true;
						return Response.json({ success: true });
					}
					if (options?.method === "DELETE") {
						deleted = true;
						return Response.json({ success: true });
					}
					if (url.includes("/count"))
						return Response.json({ count: isRead || deleted ? 0 : 1 });
					return Response.json({
						notifications: deleted
							? []
							: [
									{
										id: "notification-a",
										userId: "user-a",
										organizationId: "org-a",
										type: "water_reminder",
										title: "Fixture update",
										message: "Fixture notification",
										isRead,
										createdAt: "2026-10-24T09:00:00Z",
										metadata: {},
										timeAgo: "1 hour ago",
									},
								],
						total: deleted ? 0 : 1,
						hasMore: false,
					});
				}),
			);
			const user = userEvent.setup();
			render(
				<QueryClientProvider client={client}>
					<NotificationBell />
				</QueryClientProvider>,
			);
			await user.click(
				(await screen.findAllByLabelText("Notifications (1 unread)"))[1],
			);
			await screen.findByText("Fixture update");
			await user.click(screen.getByTitle(action));
			await waitFor(() =>
				expect(
					screen.queryAllByLabelText("Notifications (1 unread)"),
				).toHaveLength(0),
			);
			if (action.startsWith("Delete"))
				await screen.findByText("No notifications");
			else
				await waitFor(() =>
					expect(screen.queryByTitle("Mark as read")).toBeNull(),
				);
			expect(
				requests.filter((url) => url.startsWith("/api/notifications?")),
			).toHaveLength(2);
			expect(
				requests.filter((url) => url === "/api/notifications/count"),
			).toHaveLength(2);
			expect(methods.filter((method) => method !== "GET")).toHaveLength(1);
			expect(client.getQueryState(otherInbox)?.isInvalidated).toBe(false);
			expect(client.getQueryState(preferences)?.isInvalidated).toBe(false);
		},
	);

	it("shows a failed list read with a working retry instead of an empty success", async () => {
		let failed = true;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				requests.push(url);
				if (url.includes("/count")) return Response.json({ count: 3 });
				return failed
					? Response.json({ error: "Fixture read failed" }, { status: 503 })
					: Response.json({ notifications: [], total: 0, hasMore: false });
			}),
		);
		const user = userEvent.setup();
		render(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		await user.click(
			(await screen.findAllByLabelText("Notifications (3 unread)"))[1],
		);
		await screen.findByRole("alert");
		expect(screen.queryByText("No notifications")).toBeNull();
		failed = false;
		await user.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByText("No notifications");
		expect(
			requests.filter((url) => url.startsWith("/api/notifications?")),
		).toHaveLength(2);
	});

	it("announces loading while the opened list is pending", async () => {
		const pending = Promise.withResolvers<Response>();
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) =>
				url.includes("/count")
					? Promise.resolve(Response.json({ count: 3 }))
					: pending.promise,
			),
		);
		const user = userEvent.setup();
		render(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		await user.click(
			(await screen.findAllByLabelText("Notifications (3 unread)"))[1],
		);
		await screen.findByRole("status", { name: "Notifications" });
		expect(screen.queryByText("No notifications")).toBeNull();
		pending.resolve(
			Response.json({ notifications: [], total: 0, hasMore: false }),
		);
		await screen.findByText("No notifications");
	});

	it("keeps a completed previous-organization mutation from refreshing the new inbox", async () => {
		const pending = Promise.withResolvers<Response>();
		const reads: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string, options?: RequestInit) => {
				if (options?.method === "PATCH") return pending.promise;
				const organization = new Headers(options?.headers).get(
					"x-z8-notification-organization",
				);
				reads.push(`${organization}:${url}`);
				return Promise.resolve(
					Response.json(
						url.includes("/count")
							? { count: organization === "org-b" ? 7 : 1 }
							: { notifications: [], total: 0, hasMore: false },
					),
				);
			}),
		);
		const user = userEvent.setup();
		const view = render(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		await user.click(
			(await screen.findAllByLabelText("Notifications (1 unread)"))[1],
		);
		await screen.findByText("No notifications");
		await user.click(screen.getByTitle("Mark all read"));
		identity.organizationId = "org-b";
		identity.contextOrganizationId = "org-b";
		view.rerender(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		await screen.findAllByLabelText("Notifications (7 unread)");
		pending.resolve(Response.json({ success: true }));
		await waitFor(() =>
			expect(screen.getByTitle("Mark all read").hasAttribute("disabled")).toBe(
				false,
			),
		);
		expect(
			reads.filter(
				(read) => read.startsWith("org-b:") && read.includes("/count"),
			),
		).toHaveLength(1);
		expect(
			client.getQueryState(
				queryKeys.notifications.unreadCount("org-a", "user-a"),
			)?.isInvalidated,
		).toBe(true);
	});

	it("keeps the opened list loading while the current session is pending", async () => {
		identity.sessionPending = true;
		const user = userEvent.setup();
		const view = render(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		await user.click((await screen.findAllByLabelText("Notifications"))[1]);
		await screen.findByRole("status", { name: "Notifications" });
		expect(requests).toHaveLength(0);
		identity.sessionPending = false;
		view.rerender(
			<QueryClientProvider client={client}>
				<NotificationBell />
			</QueryClientProvider>,
		);
		await screen.findByText("No notifications");
	});
});
