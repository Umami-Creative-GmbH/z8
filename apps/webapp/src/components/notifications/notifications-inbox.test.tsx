/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsInbox } from "@/components/notifications/notifications-inbox";
import { useNotifications } from "@/hooks/use-notifications";
import { useOrganization } from "@/hooks/use-organization";

vi.mock("@/hooks/use-notifications", () => ({
	useNotifications: vi.fn(),
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({
		t: (_key: string, defaultValue: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(message, [name, value]) => message.replace(`{${name}}`, String(value)),
				defaultValue,
			),
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: ComponentProps<"a">) => (
		<a href={String(href)} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({ push: vi.fn() }),
}));

const useNotificationsMock = vi.mocked(useNotifications);
const useOrganizationMock = vi.mocked(useOrganization);

function mockEmptyNotifications() {
	useOrganizationMock.mockReturnValue({
		organizationId: "org_123",
		employeeId: "emp_123",
		role: "employee",
		isLoading: false,
		error: null,
		isAdmin: false,
		isManager: false,
		isManagerOrAbove: false,
		refetch: vi.fn(),
	});

	useNotificationsMock.mockReturnValue({
		notifications: [],
		total: 0,
		hasMore: false,
		isLoading: false,
		isFetching: false,
		isError: false,
		unreadCount: 0,
		isLoadingCount: false,
		markAsRead: vi.fn(),
		markAllAsRead: vi.fn(),
		deleteNotification: vi.fn(),
		deleteAllNotifications: vi.fn(),
		isMarkingRead: false,
		isMarkingAllRead: false,
		isDeleting: false,
		isDeletingAll: false,
		refresh: vi.fn(),
	});
}

describe("NotificationsInbox", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEmptyNotifications();
	});

	it("renders the empty inbox state with settings link", () => {
		render(<NotificationsInbox />);

		expect(screen.getByText("Notifications")).toBeTruthy();
		expect(screen.getByText("No notifications")).toBeTruthy();
		expect(screen.getByText("You are all caught up. New updates will appear here.")).toBeTruthy();
		expect(screen.getByRole("link", { name: /settings/i }).getAttribute("href")).toBe(
			"/settings/notifications",
		);
		expect(useNotificationsMock).toHaveBeenCalledWith({
			enabled: true,
			limit: 100,
			organizationId: "org_123",
		});
	});

	it("shows the unread empty state when the unread filter is selected", () => {
		render(<NotificationsInbox />);

		fireEvent.click(screen.getByRole("button", { name: "Unread" }));

		expect(screen.getByText("No unread notifications")).toBeTruthy();
		expect(
			screen.getByText("You are all caught up. New unread updates will appear here."),
		).toBeTruthy();
	});
});
