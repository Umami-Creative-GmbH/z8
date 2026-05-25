/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, defaultValue?: string) => defaultValue ?? _key }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/env", () => {
	throw new Error("client component imported server env");
});

describe("InfoFooter", () => {
	test("renders external legal links and local licenses without importing server env", async () => {
		const { InfoFooter } = await import("./info-footer");

		render(<InfoFooter />);

		expect(screen.getByText("Terms of Service").getAttribute("href")).toBe(
			"https://www.z8-time.app/terms-app",
		);
		expect(screen.getByText("Privacy Policy").getAttribute("href")).toBe(
			"https://www.z8-time.app/privacy-app",
		);
		expect(screen.getByText("Imprint").getAttribute("href")).toBe(
			"https://www.z8-time.app/imprint",
		);
		expect(screen.getByText("AGB").getAttribute("href")).toBe("https://www.z8-time.app/agb");
		expect(screen.getByText("Trust Center").getAttribute("href")).toBe(
			"https://www.z8-time.app/trustcenter",
		);
		expect(screen.getByText("Open Source Licenses").getAttribute("href")).toBe("/licenses");
		expect(screen.queryByText(/Version/)).toBeNull();
	});
});
