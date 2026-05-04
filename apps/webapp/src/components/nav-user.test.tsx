/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, defaultValue?: string) => defaultValue ?? _key }),
}));

vi.mock("next-intl", () => ({
	useLocale: () => "en",
}));

vi.mock("next-themes", () => ({
	useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

vi.mock("@/navigation", () => ({
	usePathname: () => "/settings/profile",
	useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

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
	DropdownMenuRadioGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuRadioItem: ({
		children,
		className,
	}: {
		children: React.ReactNode;
		className?: string;
	}) => <div className={className}>{children}</div>,
	DropdownMenuSeparator: () => <hr />,
	DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { NavUser } from "./nav-user";

describe("NavUser", () => {
	it("collapses mobile language and theme options until their sections are opened", () => {
		render(<NavUser user={{ id: "user-1", name: "Kai", email: "kai@example.com" }} />);

		expect(screen.getByRole("button", { name: /language/i })).toBeTruthy();
		expect(screen.getByRole("button", { name: /theme/i })).toBeTruthy();
		expect(screen.queryByText("Deutsch")).toBeNull();
		expect(screen.queryByText("Light")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /language/i }));
		expect(screen.getByText("Deutsch")).toBeTruthy();
		expect(screen.queryByText("Light")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /theme/i }));
		expect(screen.getByText("Light")).toBeTruthy();
	});

	it("uses selected row styling instead of radio dots for mobile options", () => {
		render(<NavUser user={{ id: "user-1", name: "Kai", email: "kai@example.com" }} />);

		fireEvent.click(screen.getByRole("button", { name: /language/i }));
		const selectedLanguage = screen.getByText("English").closest("div");

		expect(selectedLanguage?.className).toContain("data-[state=checked]:bg-accent");
		expect(selectedLanguage?.className).toContain("pl-2");
		expect(selectedLanguage?.className).not.toContain("pl-8");
	});
});
