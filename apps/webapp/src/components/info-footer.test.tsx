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
	test("renders without importing server environment config", async () => {
		const { InfoFooter } = await import("./info-footer");

		render(<InfoFooter buildHash="build-123" />);

		expect(screen.getByText("Terms of Service")).toBeTruthy();
		expect(screen.getByText("Version build-123")).toBeTruthy();
	});
});
