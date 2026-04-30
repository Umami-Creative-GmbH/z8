/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AuthLayout from "./layout";

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/image", () => ({
	default: ({ alt, className }: { alt: string; className?: string }) => (
		<img alt={alt} className={className} data-testid="auth-side-image" />
	),
}));

vi.mock("next/script", () => ({
	default: ({ id }: { id: string }) => <script data-testid={id} />,
}));

vi.mock("next/server", () => ({
	connection: vi.fn(async () => undefined),
}));

vi.mock("@/components/info-footer", () => ({
	InfoFooter: () => <footer>Info footer</footer>,
}));

vi.mock("@/components/language-switcher", () => ({
	LanguageSwitcher: () => <button type="button">Language</button>,
}));

vi.mock("@/components/theme-toggle", () => ({
	ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("@/env", () => ({
	env: {},
}));

vi.mock("@/lib/auth/domain-auth-context", () => ({
	DomainAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/domain", () => ({
	getDomainConfig: vi.fn(),
}));

vi.mock("@/lib/platform-settings", () => ({
	getCookieConsentScript: vi.fn(async () => null),
}));

vi.mock("@/proxy", () => ({
	DOMAIN_HEADERS: { DOMAIN: "x-domain" },
}));

vi.mock("@/tolgee/shared", () => ({
	ALL_LANGUAGES: ["en"],
}));

describe("AuthLayout", () => {
	it("keeps the image panel fixed while the left side scrolls", async () => {
		render(
			await AuthLayout({
				children: <div>Auth content</div>,
			}),
		);

		const content = screen.getByText("Auth content");
		const leftPanel = content.closest("section");
		const imagePanel = screen.getByTestId("auth-side-image").closest("aside");

		expect(leftPanel?.className).toContain("h-svh");
		expect(leftPanel?.className).toContain("overflow-y-auto");
		expect(imagePanel?.className).toContain("fixed");
		expect(imagePanel?.className).toContain("right-0");
		expect(imagePanel?.className).toContain("h-svh");
	});
});
