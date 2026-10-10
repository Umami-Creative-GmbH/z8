/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_BANNER_DISMISSED_AT_STORAGE_KEY } from "@/lib/store-app/app-banner";
import { GetTheAppBanner } from "./get-the-app-banner";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const APP_STORE_URL = "https://apps.apple.com/app/z8/id1234567890";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.z8.app";
const IPHONE_SAFARI =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

function emulateBrowser({ userAgent, phoneWidth }: { userAgent: string; phoneWidth: boolean }) {
	vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
	window.matchMedia = vi.fn((query: string) => ({
		matches: query === "(max-width: 767px)" ? phoneWidth : false,
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("GetTheAppBanner", () => {
	it("renders nothing without store URLs configured", () => {
		emulateBrowser({ userAgent: IPHONE_SAFARI, phoneWidth: true });

		const { container } = render(<GetTheAppBanner storeUrls={{ ios: null, android: null }} />);

		expect(container.innerHTML).toBe("");
	});

	it("links a phone browser to its store and hides for this browser once dismissed", () => {
		emulateBrowser({ userAgent: IPHONE_SAFARI, phoneWidth: true });

		render(<GetTheAppBanner storeUrls={{ ios: APP_STORE_URL, android: PLAY_STORE_URL }} />);

		expect(screen.getByRole("complementary", { name: "Z8 for your phone" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Get the app" }).getAttribute("href")).toBe(
			APP_STORE_URL,
		);

		fireEvent.click(screen.getByRole("button", { name: "Dismiss app suggestion" }));

		expect(screen.queryByRole("complementary")).toBeNull();
		expect(window.localStorage.getItem(APP_BANNER_DISMISSED_AT_STORAGE_KEY)).toEqual(
			expect.any(String),
		);
	});

	it("renders nothing at tablet or desktop width", () => {
		emulateBrowser({ userAgent: IPHONE_SAFARI, phoneWidth: false });

		const { container } = render(
			<GetTheAppBanner storeUrls={{ ios: APP_STORE_URL, android: PLAY_STORE_URL }} />,
		);

		expect(container.innerHTML).toBe("");
	});
});
