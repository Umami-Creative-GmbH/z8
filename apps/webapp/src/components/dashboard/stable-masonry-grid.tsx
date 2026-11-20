"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { assignMasonryColumns, preservesRelativeOrder } from "./stable-masonry";

const COLUMN_COUNT_PROPERTY = "--masonry-columns";

/**
 * A masonry grid whose widgets keep their column.
 *
 * `className` sets the column count through `--masonry-columns`, usually with container
 * queries, e.g. `[--masonry-columns:1] @xl/main:[--masonry-columns:2]`.
 *
 * Until it has measured its items (server render, no JavaScript), the grid is a balanced CSS
 * multi-column layout. Afterwards every item is pinned to a grid column and spans 1px rows to
 * its own height, so a widget that grows only pushes down the widgets below it in the same
 * column. While the dashboard loads, placement is re-balanced as heights settle; from the
 * first pointer or key press inside the grid, placed items stay put (see `assignMasonryColumns`).
 * Items are the grid's descendants that render a box: `display: contents` wrappers are walked
 * through, so region and slot wrappers keep working.
 */
export function StableMasonryGrid({
	className,
	children,
}: {
	className: string;
	children: ReactNode;
}) {
	return (
		<div
			ref={observeMasonryGrid}
			className={cn(
				"min-w-0 gap-x-4 columns-(--masonry-columns)",
				"data-[masonry=ready]:grid data-[masonry=ready]:grid-flow-row-dense data-[masonry=ready]:auto-rows-[1px] data-[masonry=ready]:grid-cols-[repeat(var(--masonry-columns),minmax(0,1fr))]",
				className,
			)}
		>
			{children}
		</div>
	);
}

function observeMasonryGrid(container: HTMLDivElement | null) {
	if (!container) return;
	if (typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") {
		return;
	}

	let engaged = false;
	let columnCount = 0;
	let order: HTMLElement[] = [];
	let assignment = new Map<HTMLElement, number>();
	let observed = new Set<HTMLElement>();
	let frame = 0;

	const layout = () => {
		const nextColumnCount = readColumnCount(container);
		const items = collectItems(container);
		const heights = items.map(outerHeight);
		const keep = engaged && nextColumnCount === columnCount && preservesRelativeOrder(order, items);

		assignment = assignMasonryColumns(
			items.map((key, index) => ({ key, height: heights[index] })),
			nextColumnCount,
			keep ? assignment : undefined,
		);
		columnCount = nextColumnCount;
		order = items;

		items.forEach((item, index) => {
			item.style.gridColumnStart = String((assignment.get(item) ?? 0) + 1);
			item.style.gridRowEnd = `span ${Math.max(1, Math.ceil(heights[index]))}`;
			item.style.alignSelf = "start";
		});

		const current = new Set(items);
		for (const item of observed) {
			if (!current.has(item)) {
				resizeObserver.unobserve(item);
				clearPlacement(item);
			}
		}
		for (const item of items) {
			if (!observed.has(item)) resizeObserver.observe(item);
		}
		observed = current;
		container.dataset.masonry = "ready";
	};

	// Height changes only change row spans, which never resize an item, so they are laid
	// out synchronously and nothing overlaps for a frame. A column-count change moves items
	// between columns of different widths; that waits a frame so the observer does not loop.
	const resizeObserver = new ResizeObserver(() => {
		if (readColumnCount(container) === columnCount) {
			layout();
			return;
		}
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(layout);
	});
	const mutationObserver = new MutationObserver(layout);
	const engage = () => {
		engaged = true;
	};

	layout();
	mutationObserver.observe(container, { childList: true, subtree: true });
	container.addEventListener("pointerdown", engage, true);
	container.addEventListener("keydown", engage, true);

	return () => {
		cancelAnimationFrame(frame);
		resizeObserver.disconnect();
		mutationObserver.disconnect();
		container.removeEventListener("pointerdown", engage, true);
		container.removeEventListener("keydown", engage, true);
		for (const item of observed) clearPlacement(item);
		delete container.dataset.masonry;
	};
}

function readColumnCount(container: HTMLElement): number {
	const value = Number.parseInt(
		getComputedStyle(container).getPropertyValue(COLUMN_COUNT_PROPERTY),
		10,
	);
	return Number.isFinite(value) && value > 0 ? value : 1;
}

function collectItems(container: HTMLElement): HTMLElement[] {
	const items: HTMLElement[] = [];
	const visit = (parent: Element) => {
		for (const child of parent.children) {
			if (!(child instanceof HTMLElement)) continue;
			const display = getComputedStyle(child).display;
			if (display === "contents") visit(child);
			else if (display !== "none") items.push(child);
		}
	};
	visit(container);
	return items;
}

function outerHeight(item: HTMLElement): number {
	const style = getComputedStyle(item);
	return (
		item.getBoundingClientRect().height +
		(Number.parseFloat(style.marginTop) || 0) +
		(Number.parseFloat(style.marginBottom) || 0)
	);
}

function clearPlacement(item: HTMLElement) {
	item.style.gridColumnStart = "";
	item.style.gridRowEnd = "";
	item.style.alignSelf = "";
}
