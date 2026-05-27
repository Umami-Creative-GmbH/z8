/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFontSizeState = vi.hoisted(() => ({
	fontSize: "default",
	setFontSize: vi.fn(),
}));

const mockNavigation = vi.hoisted(() => ({
	push: vi.fn(),
	replace: vi.fn(),
}));

const mockLanguageActions = vi.hoisted(() => ({
	setLanguage: vi.fn(async () => undefined),
	persistLocaleToDb: vi.fn(async () => undefined),
}));

const mockThemeState = vi.hoisted(() => ({
	clearThemeError: vi.fn(),
	setTheme: vi.fn(),
	theme: "system",
	themeError: undefined as "location-required" | undefined,
	timeThemeInfo: undefined as
		| { currentTheme: "light" | "dark"; nextSwitchAt: Date; nextTheme: "light" | "dark" }
		| undefined,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, params?: Record<string, string | number>) => {
			let value = defaultValue ?? _key;
			for (const [paramKey, paramValue] of Object.entries(params ?? {})) {
				value = value.replaceAll(`{${paramKey}}`, String(paramValue));
			}
			return value;
		},
	}),
}));

vi.mock("@/components/font-size-preference", async () => {
	const actual = await vi.importActual<typeof import("@/components/font-size-preference")>(
		"@/components/font-size-preference",
	);
	return {
		...actual,
		useFontSizePreference: () => mockFontSizeState,
	};
});

vi.mock("next-intl", () => ({
	useLocale: () => "en",
}));

vi.mock("@/components/theme-provider", () => ({
	useTheme: () => mockThemeState,
}));

vi.mock("@/navigation", () => ({
	usePathname: () => "/settings/profile",
	useRouter: () => mockNavigation,
}));

vi.mock("@/tolgee/language", () => mockLanguageActions);

vi.mock("@/lib/auth-client", () => ({
	authClient: { signOut: vi.fn() },
}));

vi.mock("@/tolgee/shared", () => ({
	ALL_LANGUAGES: ["en", "de"],
}));

vi.mock("@/lib/language-config", () => ({
	LANGUAGE_CONFIG: {
		en: { name: "English" },
		de: { name: "Deutsch" },
	},
}));

vi.mock("@/components/ui/sidebar", () => ({
	SidebarMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SidebarMenuButton: ({ children, ...props }: React.ComponentProps<"button">) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	useSidebar: () => ({ isMobile: true }),
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: () => <span data-testid="avatar" />,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
	DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuItem: ({
		children,
		...props
	}: React.ComponentProps<"button"> & { onSelect?: (event: Event) => void }) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuRadioGroup: ({
		children,
		onValueChange,
	}: {
		children: React.ReactNode;
		onValueChange?: (value: string) => void;
	}) => (
		<div>
			{React.Children.map(children, (child) => {
				if (!React.isValidElement<{ value?: string }>(child)) return child;

				return React.cloneElement(child, {
					onClick: () => child.props.value && onValueChange?.(child.props.value),
				} as Partial<React.ComponentProps<"div">>);
			})}
		</div>
	),
	DropdownMenuRadioItem: ({
		children,
		className,
		onClick,
	}: {
		children: React.ReactNode;
		className?: string;
		onClick?: () => void;
	}) => (
		<div className={className} onClick={onClick}>
			{children}
		</div>
	),
	DropdownMenuSeparator: () => <hr />,
	DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
	},
}));

const toastErrorMock = vi.mocked(toast.error);

import { NavUser } from "./nav-user";

describe("NavUser", () => {
	beforeEach(() => {
		mockThemeState.clearThemeError.mockClear();
		mockThemeState.setTheme.mockClear();
		toastErrorMock.mockClear();
		mockThemeState.theme = "system";
		mockThemeState.themeError = undefined;
		mockThemeState.timeThemeInfo = undefined;
	});

	it("persists language changes before navigating to the localized route", async () => {
		render(<NavUser user={{ id: "user-1", name: "Kai", email: "kai@example.com" }} />);

		fireEvent.click(screen.getByRole("button", { name: /language/i }));
		fireEvent.click(screen.getByText("Deutsch"));

		await waitFor(() => {
			expect(mockLanguageActions.setLanguage).toHaveBeenCalledWith("de");
			expect(mockLanguageActions.persistLocaleToDb).toHaveBeenCalledWith("de");
			expect(mockNavigation.replace).toHaveBeenCalledWith("/settings/profile", { locale: "de" });
		});
	});

	it("collapses mobile language, font size, and theme options until their sections are opened", () => {
		render(<NavUser user={{ id: "user-1", name: "Kai", email: "kai@example.com" }} />);

		expect(screen.getByRole("button", { name: /language/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: /font size/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: /theme/i })).toBeTruthy();
		expect(screen.queryByText("Deutsch")).toBeNull();
		expect(screen.queryByText("Comfortable")).toBeNull();
		expect(screen.queryByText("Light")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /language/i }));
		expect(screen.getByText("Deutsch")).toBeTruthy();
		expect(screen.queryByText("Comfortable")).toBeNull();
		expect(screen.queryByText("Light")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /font size/i }));
		expect(screen.getByText("Comfortable")).toBeTruthy();
		expect(screen.queryByText("Deutsch")).toBeNull();
		expect(screen.queryByText("Light")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /theme/i }));
		expect(screen.getByText("Light")).toBeTruthy();
		expect(screen.getByText("Time based")).toBeTruthy();
	});

	it("shows the location-required message for time-based theme errors", () => {
		mockThemeState.themeError = "location-required";

		render(<NavUser user={{ id: "user-1", name: "Kai", email: "kai@example.com" }} />);

		fireEvent.click(screen.getByRole("button", { name: /theme/i }));

		expect(screen.getByRole("alert").textContent).toBe(
			"Location permission is required for time-based theme.",
		);
	});

	it("shows a toast for location-required theme errors", () => {
		mockThemeState.themeError = "location-required";

		render(<NavUser user={{ id: "user-1", name: "Kai", email: "kai@example.com" }} />);

		expect(toastErrorMock).toHaveBeenCalledWith(
			"Location permission is required for time-based theme.",
			expect.objectContaining({
				description: "System theme will be used instead.",
				id: "theme-location-required",
				duration: 6000,
			}),
		);
	});

	it("shows when the active time-based theme will switch modes", () => {
		mockThemeState.theme = "time";
		mockThemeState.timeThemeInfo = {
			currentTheme: "light",
			nextSwitchAt: new Date("2026-05-27T18:00:00.000Z"),
			nextTheme: "dark",
		};

		render(<NavUser user={{ id: "user-1", name: "Kai", email: "kai@example.com" }} />);

		fireEvent.click(screen.getByRole("button", { name: /theme/i }));

		expect(screen.getByText(/Time based is using Light mode\./).textContent).toContain(
			"Switches to Dark at",
		);
	});

	it("uses selected row styling instead of radio dots for mobile options", () => {
		render(<NavUser user={{ id: "user-1", name: "Kai", email: "kai@example.com" }} />);

		fireEvent.click(screen.getByRole("button", { name: /language/i }));
		const selectedLanguage = screen.getByText("English").closest("div");

		expect(selectedLanguage?.className).toContain("data-[state=checked]:bg-accent");
		expect(selectedLanguage?.className).toContain("pl-2");
		expect(selectedLanguage?.className).not.toContain("pl-8");
	});

	it("uses selected row styling for mobile font size options", () => {
		render(<NavUser user={{ id: "user-1", name: "Kai", email: "kai@example.com" }} />);

		fireEvent.click(screen.getByRole("button", { name: /font size/i }));
		const selectedFontSize = screen.getByText("Default").closest("div");

		expect(selectedFontSize?.className).toContain("data-[state=checked]:bg-accent");
		expect(selectedFontSize?.className).toContain("pl-2");
		expect(selectedFontSize?.className).not.toContain("pl-8");
	});
});
