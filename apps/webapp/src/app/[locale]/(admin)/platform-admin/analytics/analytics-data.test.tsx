/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePlatformAnalyticsParams } from "@/lib/platform-analytics/range";

const { client, session, read, refresh, renderCharts } = vi.hoisted(() => ({
	client: {
		data: null as { user: { id: string; role: string }; session: { id: string } } | null,
		isPending: false,
	},
	session: vi.fn(),
	read: vi.fn(),
	refresh: vi.fn(),
	renderCharts: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => client,
	authClient: { $store: { atoms: { session: { subscribe: () => () => {} } } } },
}));
vi.mock("@/lib/auth/request-session", () => ({ getRequestSession: session }));
vi.mock("@/lib/platform-analytics/service", () => ({ getPlatformAnalyticsData: read }));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: (path: string) => {
		throw Error(`redirect:${path}`);
	},
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./analytics-charts", () => ({
	PlatformAnalyticsCharts: ({ data }: { data: { marker: string } }) => {
		renderCharts(data);
		return <p>{data.marker}</p>;
	},
}));

import { PlatformAnalyticsDataSection } from "./analytics-data";

const params = parsePlatformAnalyticsParams({ range: "90d", bucket: "week" });
const operator = (sessionId: string) => ({
	user: { id: "platform-operator", role: "admin" },
	session: { id: sessionId },
});

describe("platform analytics request admission and recovery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		client.data = operator("session-a");
		client.isPending = false;
		session.mockResolvedValue(client.data);
	});
	it.each(["owner", "admin", "manager", "member"])(
		"refuses organization %s authority without platform role",
		async (organizationRole) => {
			session.mockResolvedValue({
				user: { id: "ordinary", role: "user" },
				session: { activeOrganizationId: "org", organizationRole },
			});
			await expect(PlatformAnalyticsDataSection({ parsedParams: params })).rejects.toThrow(
				"redirect:/",
			);
			expect(read).not.toHaveBeenCalled();
		},
	);
	it("redirects anonymous requests without a global query", async () => {
		session.mockResolvedValue(null);
		await expect(PlatformAnalyticsDataSection({ parsedParams: params })).rejects.toThrow(
			"redirect:/sign-in",
		);
		expect(read).not.toHaveBeenCalled();
	});
	it("refuses a banned platform operator before starting a global query", async () => {
		const proof = operator("session-a");
		session.mockResolvedValue({ ...proof, user: { ...proof.user, banned: true } });
		await expect(PlatformAnalyticsDataSection({ parsedParams: params })).rejects.toThrow(
			"redirect:/",
		);
		expect(read).not.toHaveBeenCalled();
	});
	it("requires the session identifier before starting a global query", async () => {
		session.mockResolvedValue({ user: operator("session-a").user });
		await expect(PlatformAnalyticsDataSection({ parsedParams: params })).rejects.toThrow(
			"redirect:/sign-in",
		);
		expect(read).not.toHaveBeenCalled();
	});
	it("does not start global reads until the current session has resolved", async () => {
		let settle!: (value: unknown) => void;
		session.mockReturnValue(
			new Promise((resolve) => {
				settle = resolve;
			}),
		);
		const request = PlatformAnalyticsDataSection({ parsedParams: params });
		await Promise.resolve();
		expect(read).not.toHaveBeenCalled();
		settle({ user: { id: "platform-B", role: "user" } });
		await expect(request).rejects.toThrow("redirect:/");
		expect(read).not.toHaveBeenCalled();
	});
	it("shows a sanitized read error and retries the current URL through the router", async () => {
		read.mockRejectedValueOnce(Error("private query payload"));
		render(await PlatformAnalyticsDataSection({ parsedParams: params }));
		expect(screen.getByRole("alert").textContent).toContain(
			"Could not refresh data. Please try again.",
		);
		expect(screen.queryByText("private query payload")).toBeNull();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		});
		expect(refresh).toHaveBeenCalledTimes(1);
	});
	it("passes the canonical response unchanged and does not reuse it for another actor", async () => {
		const response = { marker: "canonical-response" };
		read.mockResolvedValue(response);
		render(await PlatformAnalyticsDataSection({ parsedParams: params }));
		expect(renderCharts.mock.calls[0][0]).toBe(response);
		expect(read).toHaveBeenCalledWith(params);
		session.mockResolvedValue({ user: { id: "ordinary", role: "user" } });
		await expect(PlatformAnalyticsDataSection({ parsedParams: params })).rejects.toThrow(
			"redirect:/",
		);
		expect(read).toHaveBeenCalledTimes(1);
	});
	it("withholds a late Retry result after the same operator replaces their session", async () => {
		read.mockRejectedValueOnce(Error("initial outage"));
		const view = render(await PlatformAnalyticsDataSection({ parsedParams: params }));
		const hold = Promise.withResolvers<{ marker: string }>();
		read.mockReturnValueOnce(hold.promise);
		let retry: ReturnType<typeof PlatformAnalyticsDataSection> | undefined;
		refresh.mockImplementationOnce(() => {
			retry = PlatformAnalyticsDataSection({ parsedParams: params });
		});
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		});
		expect(read).toHaveBeenCalledTimes(2);
		expect(read).toHaveBeenNthCalledWith(2, params);

		client.data = operator("session-b");
		session.mockResolvedValue(client.data);
		hold.resolve({ marker: "retired analytics" });
		if (!retry) throw Error("Expected Retry to start an analytics read");
		view.rerender(await retry);
		expect(screen.queryByText("retired analytics")).toBeNull();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

		read.mockResolvedValue({ marker: "current analytics" });
		view.rerender(await PlatformAnalyticsDataSection({ parsedParams: params }));
		expect(screen.getByText("current analytics")).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
	});
});
