/* @vitest-environment jsdom */

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-notifications", () => ({
	useNotifications: () => ({ unreadCount: 3 }),
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ organizationId: "org-a" }),
}));

vi.mock("./notification-popover", () => ({
	NotificationPopover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("NotificationBell", () => {
	it("renders the unread count without requiring a realtime stream provider", async () => {
		const { NotificationBell } = await import("./notification-bell");

		render(<NotificationBell />);

		expect(screen.getByLabelText("Notifications (3 unread)")).toBeTruthy();
	});
});
