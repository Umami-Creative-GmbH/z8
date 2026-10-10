// @vitest-environment jsdom
import { runInNewContext } from "node:vm";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
	createAppCallbackResponse,
	createDesktopCallbackResponse,
} from "./app-browser-sign-in";

vi.mock("@/env", () => ({ env: {} }));

function request(headers: Record<string, string> = {}) {
	return new NextRequest("https://public.example.test/api/auth/app-login", {
		headers: { accept: "text/html", ...headers },
	});
}
const callback = new URL("z8://auth/callback?code=fixture-code");
async function handoff(headers: Record<string, string> = {}) {
	const response = createDesktopCallbackResponse(request(headers), callback);
	const html = await response.text();
	const document = new DOMParser().parseFromString(html, "text/html");
	return { response, html, document };
}

describe("desktop browser handoff", () => {
	it.each([false, true])(
		"attempts the exact callback automatically and retains the fallback when blocked=%s",
		async (blocked) => {
			const { document } = await handoff();
			const launch = vi.fn(() => {
				if (blocked) throw new Error("Browser blocked external launch");
			});
			runInNewContext(document.querySelector("script")?.textContent ?? "", {
				document,
				window: { location: { assign: launch } },
			});
			expect(launch).toHaveBeenCalledExactlyOnceWith(callback.toString());
			const link = document.querySelector<HTMLAnchorElement>("#open-z8");
			expect(link?.href).toBe(callback.toString());
			expect(link?.textContent).toBe("Open Z8");
		},
	);

	it("uses matching nonce permissions and permits no external resources or framing", async () => {
		const { response, document } = await handoff();
		const scriptNonce = document.querySelector("script")?.getAttribute("nonce");
		expect(scriptNonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
		expect(document.querySelector("style")?.getAttribute("nonce")).toBe(
			scriptNonce,
		);
		const policy = response.headers.get("content-security-policy");
		expect(policy).toContain(`script-src 'nonce-${scriptNonce}'`);
		expect(policy).toContain(`style-src 'nonce-${scriptNonce}'`);
		expect(policy).toContain("frame-ancestors 'none'");
		expect(policy).toContain("base-uri 'none'");
		expect(response.headers.get("x-frame-options")).toBe("DENY");
		expect(
			document.querySelectorAll("script[src], link, img, iframe, form"),
		).toHaveLength(0);
	});

	it.each([
		[{ "accept-language": "de-DE,de;q=0.9,en;q=0.8" }, "de", "Z8 öffnen"],
		[{ "accept-language": "de-DE", cookie: "NEXT_LOCALE=en" }, "en", "Open Z8"],
		[
			{ "accept-language": "en-US", cookie: "other=value; NEXT_LOCALE=de" },
			"de",
			"Z8 öffnen",
		],
		[{ "accept-language": "fr" }, "en", "Open Z8"],
	])(
		"uses browser locale preferences %s",
		async (headers, language, action) => {
			const { document } = await handoff(headers);
			expect(document.documentElement.lang).toBe(language);
			expect(document.querySelector("#open-z8")?.textContent).toBe(action);
		},
	);

	it("escapes callback parameters without creating HTML or script nodes", async () => {
		const malicious = new URL(callback);
		malicious.searchParams.set("source", '<script>window.evil=true</script>"&');
		const response = createDesktopCallbackResponse(request(), malicious);
		const document = new DOMParser().parseFromString(
			await response.text(),
			"text/html",
		);
		expect(document.querySelectorAll("script")).toHaveLength(1);
		expect(document.querySelector<HTMLAnchorElement>("#open-z8")?.href).toBe(
			malicious.toString(),
		);
	});

	it.each([
		"https://attacker.example/",
		"z8://evil/callback",
		"javascript:alert(1)",
	])("rejects an untrusted callback %s", (url) => {
		expect(() =>
			createDesktopCallbackResponse(request(), new URL(url)),
		).toThrow("Invalid desktop callback");
	});
});

describe("store app browser handoff", () => {
	const mobileCallback = new URL("z8mobile://auth/callback?code=fixture-code");

	it("opens the store app callback and names the app, not the desktop app", async () => {
		const response = createAppCallbackResponse(request(), mobileCallback, "mobile");
		const document = new DOMParser().parseFromString(await response.text(), "text/html");
		const launch = vi.fn();
		runInNewContext(document.querySelector("script")?.textContent ?? "", {
			document,
			window: { location: { assign: launch } },
		});
		expect(launch).toHaveBeenCalledExactlyOnceWith(mobileCallback.toString());
		expect(document.querySelector<HTMLAnchorElement>("#open-z8")?.href).toBe(
			mobileCallback.toString(),
		);
		expect(document.body.textContent).toContain("We are opening the Z8 app.");
		expect(document.body.textContent).not.toContain("desktop");
	});

	it.each(["z8://auth/callback?code=fixture-code", "z8mobile://evil/callback"])(
		"rejects a callback %s that is not the store app's",
		(url) => {
			expect(() => createAppCallbackResponse(request(), new URL(url), "mobile")).toThrow(
				"Invalid mobile callback",
			);
		},
	);
});
