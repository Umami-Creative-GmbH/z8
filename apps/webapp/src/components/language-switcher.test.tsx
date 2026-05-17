/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const replace = vi.fn();
let resolvePersistLocale: (() => void) | undefined;

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, defaultValue?: string) => defaultValue ?? _key }),
}));

vi.mock("next-intl", () => ({
	useLocale: () => "en",
}));

vi.mock("@/navigation", () => ({
	usePathname: () => "/settings/profile",
	useRouter: () => ({ replace }),
}));

vi.mock("@/tolgee/language", () => ({
	setLanguage: vi.fn(() => Promise.resolve()),
	persistLocaleToDb: vi.fn(
		() => new Promise<void>((resolve) => {
			resolvePersistLocale = resolve;
		}),
	),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children, onValueChange }: { children: React.ReactNode; onValueChange: (value: string) => void }) => (
		<div>
			<button type="button" onClick={() => onValueChange("de")}>
				Deutsch
			</button>
			{children}
		</div>
	),
	SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children, className }: { children: React.ReactNode; className?: string }) => (
		<div data-testid="language-trigger" className={className}>
			{children}
		</div>
	),
	SelectValue: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { LanguageSwitcher } from "./language-switcher";

describe("LanguageSwitcher", () => {
	it("waits for the saved locale preference before navigating", async () => {
		render(<LanguageSwitcher />);

		fireEvent.click(screen.getAllByText("Deutsch")[0]);

		await waitFor(() => expect(resolvePersistLocale).toBeDefined());
		expect(replace).not.toHaveBeenCalled();

		resolvePersistLocale?.();

		await waitFor(() =>
			expect(replace).toHaveBeenCalledWith("/settings/profile", { locale: "de" }),
		);
	});

	it("renders a compact admin header variant", () => {
		render(<LanguageSwitcher variant="compact" />);
		const trigger = screen.getByTestId("language-trigger");

		expect(trigger.className).toContain("w-[88px]");
		expect(trigger.textContent).not.toContain("English");
		expect(screen.getByText("EN").className).toContain("text-foreground");
	});
});
