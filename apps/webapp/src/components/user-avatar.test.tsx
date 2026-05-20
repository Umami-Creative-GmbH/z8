/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { UserAvatar } from "./user-avatar";

vi.mock("@/lib/avatar", () => ({
	generateAvatarDataUri: vi.fn(({ seed }: { seed: string }) => `data:image/svg+xml,${seed}`),
	getInitials: vi.fn((name?: string | null) => (name ? name.slice(0, 2).toUpperCase() : "?")),
}));

vi.mock("@/components/ui/avatar", () => ({
	Avatar: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
		<span data-slot="avatar" {...props}>
			{children}
		</span>
	),
	AvatarFallback: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
		<span data-slot="avatar-fallback" {...props}>
			{children}
		</span>
	),
	AvatarImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
		<img data-slot="avatar-image" {...props} />
	),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

describe("UserAvatar", () => {
	it("renders a green status badge for clocked-in users", () => {
		render(<UserAvatar seed="user-1" name="Ada Lovelace" clockStatus="clocked-in" />);

		const badge = screen.getByRole("img", { name: "Clocked in" });
		expect(badge.className).toContain("bg-emerald-500");
	});

	it("renders a red status badge for clocked-out users", () => {
		render(<UserAvatar seed="user-1" name="Ada Lovelace" clockStatus="clocked-out" />);

		const badge = screen.getByRole("img", { name: "Clocked out" });
		expect(badge.className).toContain("bg-red-500");
	});

	it("renders the status badge outside the clipped avatar root", () => {
		render(<UserAvatar seed="user-1" name="Ada Lovelace" clockStatus="clocked-in" />);

		const avatar = document.querySelector('[data-slot="avatar"]');
		const badge = screen.getByRole("img", { name: "Clocked in" });

		expect(avatar).not.toBeNull();
		expect(avatar?.contains(badge)).toBe(false);
		expect(avatar?.parentElement?.contains(badge)).toBe(true);
	});

	it("does not render a status badge when status is unknown or omitted", () => {
		const { rerender } = render(
			<UserAvatar seed="user-1" name="Ada Lovelace" clockStatus="unknown" />,
		);

		expect(screen.queryByRole("img", { name: "Clocked in" })).toBeNull();
		expect(screen.queryByRole("img", { name: "Clocked out" })).toBeNull();

		rerender(<UserAvatar seed="user-1" name="Ada Lovelace" />);

		expect(screen.queryByRole("img", { name: "Clocked in" })).toBeNull();
		expect(screen.queryByRole("img", { name: "Clocked out" })).toBeNull();
	});

	it("keeps using uploaded images before generated fallbacks", () => {
		render(<UserAvatar seed="user-1" name="Ada Lovelace" image="https://example.com/avatar.png" />);

		const image = screen.getByAltText("Ada Lovelace") as HTMLImageElement;
		expect(image.getAttribute("src")).toBe("https://example.com/avatar.png");
	});
});
