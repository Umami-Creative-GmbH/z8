/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

import { ExportButton } from "./export-button";

const data = {
	data: [{ teamName: "Operations" }],
	headers: [{ key: "teamName" as const, label: "Team" }],
	filename: "team-performance-2025-01-01",
};
const createUrl = vi.fn(() => "blob:fixture");
beforeEach(() => {
	createUrl.mockClear();
	Object.defineProperty(URL, "createObjectURL", {
		configurable: true,
		value: createUrl,
	});
	Object.defineProperty(URL, "revokeObjectURL", {
		configurable: true,
		value: vi.fn(),
	});
});
async function start() {
	fireEvent.pointerDown(screen.getByRole("button", { name: "Export" }), {
		button: 0,
		ctrlKey: false,
	});
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Export as CSV" }),
	);
}
it("discards an in-flight download when the route has unmounted", async () => {
	const pending = Promise.withResolvers<Response>();
	vi.stubGlobal(
		"fetch",
		vi.fn(() => pending.promise),
	);
	const view = render(<ExportButton data={data} />);
	await start();
	view.unmount();
	await act(async () => pending.resolve(new Response("Team\nOperations")));
	expect(createUrl).not.toHaveBeenCalled();
});

it("discards a completed old-period export after its scope changes", async () => {
	const pending = Promise.withResolvers<Response>();
	vi.stubGlobal(
		"fetch",
		vi.fn(() => pending.promise),
	);
	const view = render(<ExportButton data={data} exportScope="org-1/2025" />);
	await start();
	view.rerender(<ExportButton data={data} exportScope="org-1/2026" />);
	await act(async () => pending.resolve(new Response("Team\nOperations")));
	expect(createUrl).not.toHaveBeenCalled();
});

it("downloads the existing payload after a successful current-scope export", async () => {
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
	const fetcher = vi.fn<typeof fetch>(
		async () => new Response("Team\nOperations"),
	);
	vi.stubGlobal("fetch", fetcher);
	render(<ExportButton data={data} exportScope="org-1/2025" />);
	await act(start);
	expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({
		format: "csv",
		...data,
	});
	expect(createUrl).toHaveBeenCalledOnce();
});

it("does not revive an old download after leaving and returning to its scope", async () => {
	const pending = Promise.withResolvers<Response>();
	vi.stubGlobal(
		"fetch",
		vi.fn(() => pending.promise),
	);
	const view = render(<ExportButton data={data} exportScope="org-1/2025" />);
	await start();
	view.rerender(<ExportButton data={data} exportScope="org-1/2026" />);
	view.rerender(<ExportButton data={data} exportScope="org-1/2025" />);
	await act(async () => pending.resolve(new Response("Team\nOperations")));
	expect(createUrl).not.toHaveBeenCalled();
});

it("does not revive an old download after export eligibility is lost and restored", async () => {
	const pending = Promise.withResolvers<Response>();
	vi.stubGlobal(
		"fetch",
		vi.fn(() => pending.promise),
	);
	const view = render(<ExportButton data={data} />);
	await start();
	view.rerender(<ExportButton data={data} disabled />);
	view.rerender(<ExportButton data={data} />);
	await act(async () => pending.resolve(new Response("Team\nOperations")));
	expect(createUrl).not.toHaveBeenCalled();
});

it("keeps default exports working without a scope opt-in", async () => {
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("Team\nOperations")),
	);
	render(<ExportButton data={data} />);
	await act(start);
	expect(createUrl).toHaveBeenCalledOnce();
});

it("keeps custom export ownership and the selected format", async () => {
	const customExport = vi.fn(async () => {});
	const fetcher = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	render(<ExportButton data={data} onExport={customExport} />);
	await act(start);
	expect(customExport).toHaveBeenCalledExactlyOnceWith("csv");
	expect(fetcher).not.toHaveBeenCalled();
	expect(createUrl).not.toHaveBeenCalled();
});
