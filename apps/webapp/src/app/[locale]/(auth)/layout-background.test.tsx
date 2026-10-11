import { PassThrough } from "node:stream";
import type { ReactNode } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AuthLayout from "./layout";

const mocks = vi.hoisted(() => ({
	platformConfig: vi.fn(),
	connection: vi.fn(),
	image: {
		src: "/backgrounds/test.webp",
		width: 2560,
		height: 1440,
		blurWidth: 8,
		blurHeight: 5,
		blurDataURL: "data:image/png;base64,preview",
	},
}));

vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("next/headers", () => ({
	headers: async () => new Headers({ host: "localhost" }),
}));
vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/components/auth-background-images", () => ({
	AUTH_BACKGROUND_IMAGES: [mocks.image],
	selectRandomAuthBackgroundImage: () => mocks.image,
}));
vi.mock("@/lib/domain", () => ({
	classifyDomainHost: () => null,
	getPlatformDomainConfig: mocks.platformConfig,
	getDomainConfig: async () => null,
}));
vi.mock("@/lib/domain/request-domain", () => ({
	getCustomDomainFromHeaders: () => null,
}));
vi.mock("@/lib/platform-settings", () => ({
	getCookieConsentScript: async () => null,
}));
vi.mock("@/tolgee/shared", () => ({ ALL_LANGUAGES: ["en"] }));
vi.mock("@/tolgee/route-boundary", () => ({
	RouteTranslationBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/auth/domain-auth-context", () => ({
	DomainAuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/font-size-toggle", () => ({
	FontSizeToggle: () => null,
}));
vi.mock("@/components/info-footer", () => ({ InfoFooter: () => null }));
vi.mock("@/components/language-switcher", () => ({
	LanguageSwitcher: () => null,
}));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/shells/auth-content-loading", () => ({
	AuthContentLoading: () => <div>Loading form</div>,
}));
vi.mock("@/components/ui/loading-region", () => ({
	LoadingRegion: ({
		children,
		className,
	}: {
		children: ReactNode;
		className: string;
	}) => (
		<div className={className} role="status">
			{children}
		</div>
	),
}));

function deferred() {
	let resolve = () => {};
	const promise = new Promise<null>((complete) => {
		resolve = () => complete(null);
	});
	return { promise, resolve };
}

describe("auth background streaming", () => {
	it("streams the image and preload while domain configuration is still pending", async () => {
		const domain = deferred();
		const request = deferred();
		mocks.platformConfig.mockReturnValue(domain.promise);
		mocks.connection.mockReturnValue(request.promise);
		const output = new PassThrough();
		let html = "";
		const errors: unknown[] = [];
		output.on("data", (chunk) => {
			html += chunk.toString();
		});
		const completed = new Promise<void>((resolve, reject) => {
			output.on("end", resolve);
			output.on("error", reject);
		});
		const stream = renderToPipeableStream(
			<AuthLayout params={Promise.resolve({ locale: "en" })}>
				<div>Ready form</div>
			</AuthLayout>,
			{
				onShellReady() {
					stream.pipe(output);
				},
				onError(error) {
					errors.push(error);
				},
			},
		);

		try {
			await vi.waitFor(() => expect(html).toContain(mocks.image.blurDataURL));
			expect(html).not.toContain("<img");
			expect(html).not.toContain('as="image"');
			request.resolve();
			await vi.waitFor(() => expect(html).toContain("<img"));
			expect(html).toContain('rel="preload"');
			expect(html).toContain(
				'sizes="(min-aspect-ratio: 2560/1440) 100vw, 178vh"',
			);
			expect(html).toContain("Loading form");
			expect(html).not.toContain("Ready form");
			expect(html).toContain(
				'class="relative z-10 min-h-svh overflow-x-hidden"',
			);
			domain.resolve();
			await completed;
			expect(html).toContain("Ready form");
			expect(errors).toEqual([]);
		} finally {
			request.resolve();
			domain.resolve();
			stream.abort();
		}
	});
});
