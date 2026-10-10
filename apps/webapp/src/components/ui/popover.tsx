"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import * as React from "react";

import { getAsChildNativeButton } from "@/components/ui/base-ui-compat";
import { composeRefs } from "@/components/ui/compose-refs";
import { cn } from "@/lib/utils";

type InteractionType = Parameters<
	Extract<NonNullable<PopoverPrimitive.Popup.Props["initialFocus"]>, (...args: never[]) => unknown>
>[0];

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({
	asChild,
	children,
	nativeButton,
	render,
	...props
}: PopoverPrimitive.Trigger.Props & { asChild?: boolean }) {
	const baseRender = asChild && React.isValidElement(children) ? children : render;

	return (
		<PopoverPrimitive.Trigger
			data-slot="popover-trigger"
			nativeButton={getAsChildNativeButton(asChild, children, nativeButton)}
			render={baseRender}
			{...props}
		>
			{asChild ? null : children}
		</PopoverPrimitive.Trigger>
	);
}

type PopoverContentProps = PopoverPrimitive.Popup.Props &
	Pick<
		PopoverPrimitive.Positioner.Props,
		| "align"
		| "alignOffset"
		| "anchor"
		| "arrowPadding"
		| "collisionAvoidance"
		| "collisionBoundary"
		| "collisionPadding"
		| "disableAnchorTracking"
		| "positionMethod"
		| "side"
		| "sideOffset"
		| "sticky"
	>;

const SEARCH_FIELD_SELECTOR = '[data-slot="command-input"]';

function PopoverContent({
	align = "center",
	alignOffset,
	anchor,
	arrowPadding,
	className,
	collisionAvoidance,
	collisionBoundary,
	collisionPadding,
	disableAnchorTracking,
	initialFocus,
	positionMethod,
	ref,
	side,
	sideOffset = 4,
	sticky,
	...props
}: PopoverContentProps) {
	const popupRef = React.useRef<HTMLDivElement>(null);
	const composedRef = React.useMemo(() => composeRefs(popupRef, ref), [ref]);

	// A searchable popover opens ready to type, so focus its search field directly. Touch keeps
	// Base UI's default of focusing the popup, which avoids opening the on-screen keyboard.
	function focusSearchField(openType: InteractionType) {
		const popup = popupRef.current;
		if (openType === "touch") return popup;

		return popup?.querySelector<HTMLElement>(SEARCH_FIELD_SELECTOR) ?? true;
	}

	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				anchor={anchor}
				arrowPadding={arrowPadding}
				className="z-50 max-h-(--available-height)"
				collisionAvoidance={collisionAvoidance}
				collisionBoundary={collisionBoundary}
				collisionPadding={collisionPadding}
				data-slot="popover-positioner"
				disableAnchorTracking={disableAnchorTracking}
				positionMethod={positionMethod}
				side={side}
				sideOffset={sideOffset}
				sticky={sticky}
			>
				<PopoverPrimitive.Popup
					data-slot="popover-content"
					initialFocus={initialFocus ?? focusSearchField}
					ref={composedRef}
					className={cn(
						"bg-popover text-popover-foreground motion-safe:data-[starting-style]:animate-in motion-safe:data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 data-[ending-style]:zoom-out-95 data-[starting-style]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 max-h-(--available-height) origin-(--transform-origin) overflow-y-auto rounded-md border p-4 shadow-md outline-hidden",
						className,
					)}
					{...props}
				/>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	);
}

function PopoverAnchor({ ...props }: React.ComponentProps<"div">) {
	return <div data-slot="popover-anchor" {...props} />;
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
