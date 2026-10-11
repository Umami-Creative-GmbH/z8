import type { StaticImageData } from "next/image";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AuthBackgroundImage,
	AuthBackgroundPlaceholder,
} from "./auth-background-image";

const selectedImage = {
	src: "/backgrounds/vimal-s-J69ERsG93hI-unsplash.webp",
	width: 2560,
	height: 1440,
	blurWidth: 8,
	blurHeight: 5,
	blurDataURL:
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=",
} satisfies StaticImageData;

describe("AuthBackgroundImage", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("preloads the server-selected responsive image and includes its blur before hydration", () => {
		const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
		const html = renderToStaticMarkup(
			<AuthBackgroundImage initialImage={selectedImage} />,
		);

		expect(html).toContain(encodeURIComponent(selectedImage.src));
		expect(html).toContain("object-cover");
		expect(html).toContain('rel="preload"');
		expect(html).toContain('as="image"');
		expect(html).toContain(
			'imageSizes="(min-aspect-ratio: 2560/1440) 100vw, 178vh"',
		);
		expect(html).toContain(
			'sizes="(min-aspect-ratio: 2560/1440) 100vw, 178vh"',
		);
		expect(html).toContain("background-image:url(");
		expect(html).not.toContain('loading="lazy"');
		expect(randomSpy).not.toHaveBeenCalled();
	});

	it("shows an inline decorative preview without downloading another full image", () => {
		const html = renderToStaticMarkup(
			<AuthBackgroundPlaceholder initialImage={selectedImage} />,
		);

		expect(html).toContain(selectedImage.blurDataURL);
		expect(html).toContain('aria-hidden="true"');
		expect(html).not.toContain("<img");
		expect(html).not.toContain('rel="preload"');
		expect(html).not.toContain(selectedImage.src);
	});
});
