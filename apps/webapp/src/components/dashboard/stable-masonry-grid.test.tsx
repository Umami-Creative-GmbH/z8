// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StableMasonryGrid } from "./stable-masonry-grid";

afterEach(() => vi.unstubAllGlobals());

it("releases observers, pending layout and widget placements when the grid unmounts", () => {
	const disconnectResize = vi.fn();
	const disconnectMutation = vi.fn();
	let notifyResize: () => void = () => {
		throw new Error("Resize observer was not attached");
	};
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(notify: () => void) {
				notifyResize = notify;
			}
			observe = vi.fn();
			disconnect = disconnectResize;
		},
	);
	vi.stubGlobal(
		"MutationObserver",
		class {
			observe = vi.fn();
			disconnect = disconnectMutation;
		},
	);
	const cancelFrame = vi.fn();
	vi.stubGlobal("requestAnimationFrame", () => 42);
	vi.stubGlobal("cancelAnimationFrame", cancelFrame);

	const view = render(
		<StableMasonryGrid className="">
			<article>Widget</article>
		</StableMasonryGrid>,
	);
	const widget = view.getByRole("article");
	const grid = widget.parentElement!;
	expect(grid.dataset.masonry).toBe("ready");
	expect(widget.style.gridColumnStart).toBe("1");
	grid.style.setProperty("--masonry-columns", "2");
	notifyResize();

	view.unmount();
	expect(disconnectResize).toHaveBeenCalledOnce();
	expect(disconnectMutation).toHaveBeenCalledOnce();
	expect(cancelFrame).toHaveBeenCalledWith(42);
	expect(widget.style.gridColumnStart).toBe("");
	expect(grid.dataset.masonry).toBeUndefined();
});
