/* @vitest-environment jsdom */

import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";

const route = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({
		refresh: route.refresh,
	}),
}));

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

	return render(
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
	);
}

describe("NotificationChannelSettings", () => {
	beforeEach(() => vi.clearAllMocks());
	it.each(["refused", "network failure"])(
		"keeps edited selections and avoids refresh after a %s save",
		async (failure) => {
			const update =
				failure === "refused"
					? vi.fn().mockResolvedValue({ success: false, error: "Not accepted" })
					: vi.fn().mockRejectedValue(new Error("Connection failed"));
			renderWithQueryClient(
				<NotificationChannelSettings
					channelName="Discord"
					description="Channel configuration"
					config={{
						setupStatus: "active",
						displayName: "Discord app",
						enableApprovals: false,
						enableCommands: false,
						enableDailyDigest: false,
						enableEscalations: false,
						digestTime: "09:00",
						digestTimezone: "Europe/Berlin",
						escalationTimeoutHours: 24,
					}}
					updateAction={update}
				/>,
			);
			const selection = screen.getByRole("switch", {
				name: /Approval notifications/i,
			});
			fireEvent.click(selection);
			const save = screen.getByRole("button", { name: "Save Settings" });
			fireEvent.click(save);
			await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
			await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
			expect(selection.getAttribute("aria-checked")).toBe("true");
			expect(route.refresh).not.toHaveBeenCalled();
		},
	);
	it("refreshes its server settings after an accepted save without restarting unrelated client data", async () => {
		const load = vi.fn().mockResolvedValue("Unrelated employee data");
		const update = vi
			.fn()
			.mockResolvedValue({ success: true, data: undefined });
		function OtherView() {
			const query = useQuery({
				queryKey: ["employee-visible-read"],
				queryFn: load,
				staleTime: Infinity,
			});
			return <p>{query.data}</p>;
		}
		renderWithQueryClient(
			<>
				<OtherView />
				<NotificationChannelSettings
					channelName="Discord"
					description="Channel configuration"
					config={{
						setupStatus: "active",
						displayName: "Discord app",
						enableApprovals: false,
						enableCommands: false,
						enableDailyDigest: false,
						enableEscalations: false,
						digestTime: "09:00",
						digestTimezone: "Europe/Berlin",
						escalationTimeoutHours: 24,
					}}
					updateAction={update}
				/>
			</>,
		);
		await screen.findByText("Unrelated employee data");
		fireEvent.click(
			screen.getByRole("switch", { name: /Approval notifications/i }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));
		await waitFor(() => expect(route.refresh).toHaveBeenCalledTimes(1));
		expect(update.mock.calls[0]?.[0]).toMatchObject({ enableApprovals: true });
		expect(update.mock.calls[0]).toHaveLength(1);
		expect(load).toHaveBeenCalledTimes(1);
		await waitFor(() =>
			expect(
				screen
					.getByRole("button", { name: "Save Settings" })
					.hasAttribute("disabled"),
			).toBe(true),
		);
	});
	it("localizes known non-active setup status labels", () => {
		renderWithQueryClient(
			<NotificationChannelSettings
				channelName="Discord"
				description="Configure Discord notifications for your organization."
				config={{
					setupStatus: "pending",
					displayName: "Discord app",
					enableApprovals: false,
					enableCommands: false,
					enableDailyDigest: false,
					enableEscalations: false,
					digestTime: "09:00",
					digestTimezone: "Europe/Berlin",
					escalationTimeoutHours: 24,
				}}
				updateAction={vi.fn()}
			/>,
		);

		expect(screen.getByText("Pending")).toBeTruthy();
		expect(screen.queryByText("pending")).toBeNull();
	});

	it("keeps switch controls visible beside wrapping labels on narrow screens", () => {
		renderWithQueryClient(
			<NotificationChannelSettings
				channelName="Microsoft Teams"
				description="Configure Microsoft Teams notifications for your organization."
				config={null}
				updateAction={vi.fn()}
			/>,
		);

		const approvalLabel = screen.getByText("Approval notifications");
		const approvalCopy = screen.getByText(
			"Send approval requests and approval status updates.",
		);
		const approvalTextColumn = approvalLabel.closest("div");
		const approvalRow = approvalTextColumn?.parentElement;
		const approvalSwitch = screen.getByRole("switch", {
			name: /Approval notifications/i,
		});

		expect(approvalTextColumn?.className).toContain("min-w-0");
		expect(approvalCopy.className).toContain("break-words");
		expect(approvalRow?.className).toContain("min-w-0");
		expect(approvalSwitch.className).toContain("shrink-0");
	});
});
