/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/test/to-have-text-content";
import AccessDeniedPage from "./page-client";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: { signOut: vi.fn() },
}));

describe("AccessDeniedPage", () => {
	it("centers neutral auth loading while URL state is unresolved", () => {
		render(
			<AccessDeniedPage searchParams={new Promise<never>(() => undefined)} />,
		);

		const loading = screen.getByRole("status");
		const label = loading.querySelector<HTMLElement>(".sr-only");
		expect(loading.getAttribute("aria-busy")).toBe("true");
		expect(label).not.toBeNull();
		if (label) {
			expect(label).toHaveTextContent("Loading authentication");
		}
		expect(screen.getByTestId("access-denied-loading").className).toContain(
			"min-h-screen",
		);
		expect(screen.queryByText(/restricted|organization|sign out/i)).toBeNull();
	});
});
