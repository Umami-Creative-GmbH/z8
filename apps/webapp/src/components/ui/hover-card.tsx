"use client";

import { PreviewCard as HoverCardPrimitive } from "@base-ui/react/preview-card";
import * as React from "react";

import { cn } from "@/lib/utils";

function HoverCard({ ...props }: HoverCardPrimitive.Root.Props) {
	return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

function HoverCardTrigger({
	asChild,
	children,
	render,
	...props
}: HoverCardPrimitive.Trigger.Props & { asChild?: boolean }) {
	const baseRender = asChild && React.isValidElement(children) ? children : render;

	return (
		<HoverCardPrimitive.Trigger data-slot="hover-card-trigger" render={baseRender} {...props}>
			{asChild ? null : children}
		</HoverCardPrimitive.Trigger>
	);
}

type HoverCardContentProps = HoverCardPrimitive.Popup.Props &
	Pick<
		HoverCardPrimitive.Positioner.Props,
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

function HoverCardContent({
	align = "center",
	alignOffset,
	anchor,
	arrowPadding,
	className,
	collisionAvoidance,
	collisionBoundary,
	collisionPadding,
	disableAnchorTracking,
	positionMethod,
	side,
	sideOffset = 4,
	sticky,
	...props
}: HoverCardContentProps) {
	return (
		<HoverCardPrimitive.Portal data-slot="hover-card-portal">
			<HoverCardPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				anchor={anchor}
				arrowPadding={arrowPadding}
				className={cn("z-50 max-h-(--available-height)")}
				collisionAvoidance={collisionAvoidance}
				collisionBoundary={collisionBoundary}
				collisionPadding={collisionPadding}
				data-slot="hover-card-positioner"
				disableAnchorTracking={disableAnchorTracking}
				positionMethod={positionMethod}
				side={side}
				sideOffset={sideOffset}
				sticky={sticky}
			>
				<HoverCardPrimitive.Popup
					data-slot="hover-card-content"
					className={cn(
						"bg-popover text-popover-foreground motion-safe:data-[starting-style]:animate-in motion-safe:data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[starting-style]:fade-in-0 data-[ending-style]:zoom-out-95 data-[starting-style]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-64 origin-(--transform-origin) rounded-md border p-4 shadow-md outline-hidden",
						className,
					)}
					{...props}
				/>
			</HoverCardPrimitive.Positioner>
		</HoverCardPrimitive.Portal>
	);
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
