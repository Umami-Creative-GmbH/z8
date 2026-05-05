/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NotificationChannelSettings } from "@/components/settings/notification-channel-settings";

vi.mock("next/navigation", () => ({
	useRouter: () => ({
		refresh: vi.fn(),
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

	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

describe("NotificationChannelSettings", () => {
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
		const approvalCopy = screen.getByText("Send approval requests and approval status updates.");
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
