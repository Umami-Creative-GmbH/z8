/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationSettings } from "@/components/notifications/notification-settings";
import { useNotificationPreferences } from "@/hooks/use-notification-preferences";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import {
	NOTIFICATION_CHANNELS,
	NOTIFICATION_TYPES,
	type NotificationChannel,
	type NotificationType,
} from "@/lib/notifications/types";

vi.mock("@/hooks/use-notification-preferences", () => ({
	useNotificationPreferences: vi.fn(),
}));

vi.mock("@/hooks/use-push-notifications", () => ({
	usePushNotifications: vi.fn(),
}));

const useNotificationPreferencesMock = vi.mocked(useNotificationPreferences);
const usePushNotificationsMock = vi.mocked(usePushNotifications);

const matrix = Object.fromEntries(
	NOTIFICATION_TYPES.map((type) => [
		type,
		Object.fromEntries(NOTIFICATION_CHANNELS.map((channel) => [channel, true])),
	]),
) as Record<NotificationType, Record<NotificationChannel, boolean>>;

describe("NotificationSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		usePushNotificationsMock.mockReturnValue({
			isSupported: true,
			permission: "granted",
			isSubscribed: true,
			subscribe: vi.fn(),
			unsubscribe: vi.fn(),
			isLoading: false,
			error: null,
		});

		useNotificationPreferencesMock.mockReturnValue({
			preferences: [],
			matrix,
			availableChannels: {
				in_app: true,
				push: true,
				email: true,
				teams: false,
				telegram: false,
				discord: false,
				slack: false,
			},
			isLoading: false,
			error: null,
			updatePreference: vi.fn(),
			updatePreferenceAsync: vi.fn(),
			isUpdating: false,
			bulkUpdatePreferences: vi.fn(),
			bulkUpdatePreferencesAsync: vi.fn(),
			isBulkUpdating: false,
		});
	});

	it("renders controls only for available notification channels", () => {
		render(<NotificationSettings />);

		expect(screen.getByText("In-App")).toBeTruthy();
		expect(screen.getByText("Push")).toBeTruthy();
		expect(screen.getByText("Email")).toBeTruthy();
		expect(screen.queryByText("Slack")).toBeNull();
		expect(screen.queryByLabelText("Slack notifications for Request submitted")).toBeNull();
	});
});
