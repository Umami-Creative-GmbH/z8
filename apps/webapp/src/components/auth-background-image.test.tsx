/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { StaticImageData } from "next/image";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthBackgroundImage } from "./auth-background-image";

const selectedImage = {
	src: "/backgrounds/vimal-s-J69ERsG93hI-unsplash.jpg",
} as StaticImageData;

vi.mock("next/image", () => ({
	default: ({
		alt,
		className,
		priority,
		sizes,
		src,
	}: {
		alt: string;
		className?: string;
		priority?: boolean;
		sizes?: string;
		src: string | { src: string };
	}) => (
		<img
			alt={alt}
			className={className}
			data-priority={String(priority)}
			data-sizes={sizes}
			data-testid="auth-background-image"
			src={typeof src === "string" ? src : src.src}
		/>
	),
}));

describe("AuthBackgroundImage", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders the server-selected background without waiting for hydration", () => {
		const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

		render(<AuthBackgroundImage initialImage={selectedImage} />);

		const image = screen.getByTestId("auth-background-image");
		expect(image.getAttribute("src")).toContain("vimal-s-J69ERsG93hI-unsplash.jpg");
		expect(image.className).toContain("absolute");
		expect(image.className).toContain("object-cover");
		expect(image.getAttribute("data-priority")).toBe("true");
		expect(image.getAttribute("data-sizes")).toBe("100vw");
		expect(randomSpy).not.toHaveBeenCalled();
	});
});
