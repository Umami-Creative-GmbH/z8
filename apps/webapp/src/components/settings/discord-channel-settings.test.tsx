/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	DiscordConnectFormValues,
	DiscordConnectResult,
	DiscordNotificationChannelConfig,
} from "@/app/[locale]/(app)/settings/notification-channels/actions";
import { DiscordChannelSettings } from "@/components/settings/discord-channel-settings";
import type { ServerActionResult } from "@/lib/effect/result";

const mocks = vi.hoisted(() => ({
	refresh: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
	toastWarning: vi.fn(),
	writeText: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, params?: Record<string, string | number>) => {
			if (!defaultValue) return _key;
			if (!params) return defaultValue;
			return Object.entries(params).reduce(
				(text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
				defaultValue,
			);
		},
	}),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({
		refresh: mocks.refresh,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		success: mocks.toastSuccess,
		error: mocks.toastError,
		warning: mocks.toastWarning,
	},
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

const VALID_TOKEN = "MTIzNDU2Nzg5MDEyMzQ1Njc4.mock.token";
const VALID_APP_ID = "123456789012345678";
const VALID_PUBLIC_KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const INTERACTION_URL =
	"https://app.example.com/api/discord/interactions/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const activeConfig: DiscordNotificationChannelConfig = {
	setupStatus: "active",
	displayName: VALID_APP_ID,
	interactionUrl: INTERACTION_URL,
	enableApprovals: true,
	enableCommands: true,
	enableDailyDigest: true,
	enableEscalations: true,
	digestTime: "08:00",
	digestTimezone: "UTC",
	escalationTimeoutHours: 24,
};

function fillConnectForm(values: Partial<DiscordConnectFormValues> = {}) {
	const botToken = values.botToken ?? VALID_TOKEN;
	const applicationId = values.applicationId ?? VALID_APP_ID;
	const publicKey = values.publicKey ?? VALID_PUBLIC_KEY;

	fireEvent.change(screen.getByLabelText(/Bot Token/i), { target: { value: botToken } });
	fireEvent.change(screen.getByLabelText(/Application ID/i), { target: { value: applicationId } });
	fireEvent.change(screen.getByLabelText(/Public Key/i), { target: { value: publicKey } });
}

describe("DiscordChannelSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.writeText.mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: mocks.writeText },
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders the connect form when Discord is not configured", () => {
		renderWithQueryClient(
			<DiscordChannelSettings
				config={null}
				updateAction={vi.fn()}
				connectAction={vi.fn()}
				disconnectAction={vi.fn()}
			/>,
		);

		expect(screen.getByLabelText(/Bot Token/i)).toBeTruthy();
		expect(screen.getByLabelText(/Application ID/i)).toBeTruthy();
		expect(screen.getByLabelText(/Public Key/i)).toBeTruthy();
		expect(screen.getByRole("button", { name: /Connect Discord Bot/i })).toBeTruthy();
		expect(screen.queryByText(/not available yet/i)).toBeNull();
	});

	it("validates required and formatted fields before calling connectAction", async () => {
		const connectAction = vi.fn();
		renderWithQueryClient(
			<DiscordChannelSettings
				config={null}
				updateAction={vi.fn()}
				connectAction={connectAction}
				disconnectAction={vi.fn()}
			/>,
		);

		// Submit empty form
		fireEvent.click(screen.getByRole("button", { name: /Connect Discord Bot/i }));

		expect(await screen.findByText("Bot token is required.")).toBeTruthy();
		expect(screen.getByText("Application ID is required.")).toBeTruthy();
		expect(screen.getByText("Public key is required.")).toBeTruthy();
		expect(connectAction).not.toHaveBeenCalled();

		// Enter invalid format for applicationId and publicKey
		fillConnectForm({
			botToken: VALID_TOKEN,
			applicationId: "not-numeric",
			publicKey: "too-short",
		});
		fireEvent.click(screen.getByRole("button", { name: /Connect Discord Bot/i }));

		expect(await screen.findByText("Application ID must contain digits only.")).toBeTruthy();
		expect(screen.getByText("Public key must be a 64-character hexadecimal string.")).toBeTruthy();
		expect(connectAction).not.toHaveBeenCalled();
	});

	it("disables controls while connecting, then displays the interaction URL with copy control", async () => {
		let resolveConnect!: (value: ServerActionResult<DiscordConnectResult>) => void;
		const connectAction = vi.fn(
			() =>
				new Promise<ServerActionResult<DiscordConnectResult>>((resolve) => {
					resolveConnect = resolve;
				}),
		);

		renderWithQueryClient(
			<DiscordChannelSettings
				config={null}
				updateAction={vi.fn()}
				connectAction={connectAction}
				disconnectAction={vi.fn()}
			/>,
		);

		fillConnectForm();
		fireEvent.click(screen.getByRole("button", { name: /Connect Discord Bot/i }));

		await waitFor(() => expect(connectAction).toHaveBeenCalledTimes(1));
		expect(connectAction).toHaveBeenCalledWith({
			botToken: VALID_TOKEN,
			applicationId: VALID_APP_ID,
			publicKey: VALID_PUBLIC_KEY,
		});
		expect(screen.getByLabelText(/Bot Token/i).hasAttribute("disabled")).toBe(true);
		expect(
			screen.getByRole("button", { name: /Connect Discord Bot/i }).hasAttribute("disabled"),
		).toBe(true);

		resolveConnect({
			success: true,
			data: {
				applicationId: VALID_APP_ID,
				commandsRegistered: true,
				interactionUrl: INTERACTION_URL,
			},
		});

		const urlInput = (await screen.findByLabelText("Interaction Endpoint URL")) as HTMLInputElement;
		expect(urlInput.value).toBe(INTERACTION_URL);
		expect(mocks.refresh).toHaveBeenCalledTimes(1);
		expect(mocks.toastSuccess).toHaveBeenCalledWith("Discord bot connected successfully");

		fireEvent.click(screen.getByRole("button", { name: /Copy Interaction Endpoint URL/i }));
		await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith(INTERACTION_URL));
		expect(mocks.toastSuccess).toHaveBeenCalledWith("Interaction Endpoint URL copied");
	});

	it("gracefully reports when slash command registration fails while still showing the interaction URL", async () => {
		const connectAction = vi.fn().mockResolvedValue({
			success: true,
			data: {
				applicationId: VALID_APP_ID,
				commandsRegistered: false,
				interactionUrl: INTERACTION_URL,
			},
		});

		renderWithQueryClient(
			<DiscordChannelSettings
				config={null}
				updateAction={vi.fn()}
				connectAction={connectAction}
				disconnectAction={vi.fn()}
			/>,
		);

		fillConnectForm();
		fireEvent.click(screen.getByRole("button", { name: /Connect Discord Bot/i }));

		expect(await screen.findByDisplayValue(INTERACTION_URL)).toBeTruthy();
		expect(
			screen.getByText(
				/Discord bot connected, but slash commands could not be registered automatically/i,
			),
		).toBeTruthy();
		expect(mocks.toastWarning).toHaveBeenCalled();
	});

	it("preserves form inputs and shows localized invalid bot token error when Discord rejects the token", async () => {
		const connectAction = vi.fn().mockResolvedValue({
			success: false,
			code: "ValidationError",
			refusal: "invalid_bot_token",
			error: "Raw server error should never be shown directly",
		});

		renderWithQueryClient(
			<DiscordChannelSettings
				config={null}
				updateAction={vi.fn()}
				connectAction={connectAction}
				disconnectAction={vi.fn()}
			/>,
		);

		fillConnectForm();
		fireEvent.click(screen.getByRole("button", { name: /Connect Discord Bot/i }));

		expect(
			await screen.findByText(
				"Invalid bot token. Check your Discord bot credentials and try again.",
			),
		).toBeTruthy();
		expect(screen.queryByText(/Raw server error/i)).toBeNull();
		expect((screen.getByLabelText(/Bot Token/i) as HTMLInputElement).value).toBe(VALID_TOKEN);
		expect((screen.getByLabelText(/Application ID/i) as HTMLInputElement).value).toBe(VALID_APP_ID);
		expect((screen.getByLabelText(/Public Key/i) as HTMLInputElement).value).toBe(VALID_PUBLIC_KEY);
		expect(mocks.refresh).not.toHaveBeenCalled();
	});

	it.each([
		["application_id_mismatch", "Application ID does not match the provided bot token."],
		["public_key_mismatch", "Public key does not match the Discord application."],
	] as const)(
		"shows localized refusal error for %s while preserving entered values",
		async (refusal, expectedMessage) => {
			const connectAction = vi.fn().mockResolvedValue({
				success: false,
				code: "ValidationError",
				refusal,
				error: "Raw server mismatch error",
			});

			renderWithQueryClient(
				<DiscordChannelSettings
					config={null}
					updateAction={vi.fn()}
					connectAction={connectAction}
					disconnectAction={vi.fn()}
				/>,
			);

			fillConnectForm();
			fireEvent.click(screen.getByRole("button", { name: /Connect Discord Bot/i }));

			expect(await screen.findByText(expectedMessage)).toBeTruthy();
			expect(screen.queryByText(/Raw server mismatch error/i)).toBeNull();
			expect((screen.getByLabelText(/Application ID/i) as HTMLInputElement).value).toBe(
				VALID_APP_ID,
			);
			expect((screen.getByLabelText(/Public Key/i) as HTMLInputElement).value).toBe(
				VALID_PUBLIC_KEY,
			);
		},
	);

	it("displays the interaction URL and supports confirmed disconnect when already connected", async () => {
		const disconnectAction = vi.fn().mockResolvedValue({ success: true, data: undefined });

		renderWithQueryClient(
			<DiscordChannelSettings
				config={activeConfig}
				updateAction={vi.fn()}
				connectAction={vi.fn()}
				disconnectAction={disconnectAction}
			/>,
		);

		expect(screen.getByDisplayValue(INTERACTION_URL)).toBeTruthy();
		expect(screen.queryByLabelText(/Bot Token/i)).toBeNull();

		// Open confirmation dialog
		fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
		expect(await screen.findByText("Disconnect Discord Bot?")).toBeTruthy();
		expect(disconnectAction).not.toHaveBeenCalled();

		// Confirm disconnect
		const disconnectButtons = screen.getAllByRole("button", { name: "Disconnect" });
		fireEvent.click(disconnectButtons[disconnectButtons.length - 1]);

		await waitFor(() => expect(disconnectAction).toHaveBeenCalledTimes(1));
		expect(await screen.findByLabelText(/Bot Token/i)).toBeTruthy();
		expect(screen.queryByDisplayValue(INTERACTION_URL)).toBeNull();
		expect(mocks.toastSuccess).toHaveBeenCalledWith("Discord bot disconnected");
		expect(mocks.refresh).toHaveBeenCalledTimes(1);
	});

	it("keeps the disconnect confirmation dialog open with an inline error when disconnecting fails", async () => {
		const disconnectAction = vi.fn().mockResolvedValue({
			success: false,
			code: "ExternalServiceError",
			error: "Internal error",
		});

		renderWithQueryClient(
			<DiscordChannelSettings
				config={activeConfig}
				updateAction={vi.fn()}
				connectAction={vi.fn()}
				disconnectAction={disconnectAction}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
		await screen.findByText("Disconnect Discord Bot?");

		const disconnectButtons = screen.getAllByRole("button", { name: "Disconnect" });
		fireEvent.click(disconnectButtons[disconnectButtons.length - 1]);

		expect(await screen.findByText("Failed to disconnect Discord bot")).toBeTruthy();
		expect(screen.getByText("Disconnect Discord Bot?")).toBeTruthy();
		expect(mocks.refresh).not.toHaveBeenCalled();
	});
});
