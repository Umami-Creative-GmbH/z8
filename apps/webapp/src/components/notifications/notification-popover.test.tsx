/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationPopover } from "@/components/notifications/notification-popover";
import { useNotifications } from "@/hooks/use-notifications";
import { useOrganization } from "@/hooks/use-organization";

vi.mock("@/hooks/use-notifications", () => ({
	useNotifications: vi.fn(),
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue: string) => defaultValue,
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: ComponentProps<"a">) => (
		<a href={String(href)} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@/components/ui/sheet", async () => {
	const React = await import("react");
	const SheetContext = React.createContext<{
		open: boolean;
		onOpenChange: (open: boolean) => void;
	} | null>(null);

	return {
		Sheet: ({
			open,
			onOpenChange,
			children,
		}: {
			open: boolean;
			onOpenChange: (open: boolean) => void;
			children: React.ReactNode;
		}) => <SheetContext.Provider value={{ open, onOpenChange }}>{children}</SheetContext.Provider>,
		SheetContent: ({
			side,
			className,
			showCloseButton = true,
			children,
		}: {
			side: string;
			className?: string;
			showCloseButton?: boolean;
			children: React.ReactNode;
		}) => {
			const context = React.useContext(SheetContext);

			if (!context?.open) {
				return null;
			}

			return (
				<dialog aria-label="Notifications" className={className} data-side={side} open>
					{showCloseButton && <button type="button">Close</button>}
					{children}
				</dialog>
			);
		},
		SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
		SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
		SheetTrigger: ({ children }: { children: React.ReactElement<{ onClick?: () => void }> }) => {
			const context = React.useContext(SheetContext);

			return React.cloneElement(children, {
				"data-slot": "sheet-trigger",
				onClick: () => context?.onOpenChange(true),
			});
		},
	};
});

const useNotificationsMock = vi.mocked(useNotifications);
const useOrganizationMock = vi.mocked(useOrganization);

function mockNotificationDependencies() {
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

describe("NotificationPopover", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockNotificationDependencies();
	});

	it("opens notifications in a top sheet from the mobile trigger", async () => {
		const user = userEvent.setup();

		render(
			<NotificationPopover>
				<button type="button">Open notifications</button>
			</NotificationPopover>,
		);

		await user.click(screen.getAllByRole("button", { name: "Open notifications" })[0]);

		const sheetContent = await waitFor(() => screen.getByRole("dialog", { name: "Notifications" }));
		expect(sheetContent).toBeTruthy();
		expect(sheetContent.getAttribute("data-side")).toBe("top");
		expect(sheetContent.className).toContain("max-h-[85dvh]");
		expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
		expect(screen.getByText("No notifications")).toBeTruthy();
	});
});
