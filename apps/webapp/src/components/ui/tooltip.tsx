"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import * as React from "react";
import { use } from "react";

import { cn } from "@/lib/utils";

type TooltipProviderProps = Omit<TooltipPrimitive.Provider.Props, "delay" | "timeout"> & {
	delay?: number;
	delayDuration?: number;
	skipDelayDuration?: number;
	timeout?: number;
};

const TooltipProviderContext = React.createContext(false);

function TooltipProvider({
	delay,
	delayDuration,
	skipDelayDuration,
	timeout,
	...props
}: TooltipProviderProps) {
	return (
		<TooltipProviderContext.Provider value>
			<TooltipPrimitive.Provider
				data-slot="tooltip-provider"
				delay={delay ?? delayDuration ?? 0}
				timeout={timeout ?? skipDelayDuration}
				{...props}
			/>
		</TooltipProviderContext.Provider>
	);
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
	const hasTooltipProvider = use(TooltipProviderContext);
	const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />;

	if (hasTooltipProvider) {
		return root;
	}

	return <TooltipProvider>{root}</TooltipProvider>;
}

function TooltipTrigger({
	asChild,
	children,
	render,
	...props
}: TooltipPrimitive.Trigger.Props & { asChild?: boolean }) {
	const baseRender = asChild && React.isValidElement(children) ? children : render;

	return (
		<TooltipPrimitive.Trigger data-slot="tooltip-trigger" render={baseRender} {...props}>
			{asChild ? null : children}
		</TooltipPrimitive.Trigger>
	);
}

type TooltipContentProps = TooltipPrimitive.Popup.Props &
	Pick<
		TooltipPrimitive.Positioner.Props,
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

function TooltipContent({
	align,
	alignOffset,
	anchor,
	arrowPadding,
	className,
	collisionAvoidance,
	collisionBoundary,
	collisionPadding,
	sideOffset = 4,
	disableAnchorTracking,
	positionMethod,
	side,
	sticky,
	children,
	...props
}: TooltipContentProps) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				anchor={anchor}
				arrowPadding={arrowPadding}
				className={cn("z-50 max-h-(--available-height)")}
				collisionAvoidance={collisionAvoidance}
				collisionBoundary={collisionBoundary}
				collisionPadding={collisionPadding}
				data-slot="tooltip-positioner"
				disableAnchorTracking={disableAnchorTracking}
				positionMethod={positionMethod}
				side={side}
				sideOffset={sideOffset}
				sticky={sticky}
			>
				<TooltipPrimitive.Popup
					className={cn(
						"fade-in-0 zoom-in-95 data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--transform-origin) motion-safe:data-[starting-style]:animate-in text-balance rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-xs motion-safe:data-[ending-style]:animate-out",
						className,
					)}
					data-slot="tooltip-content"
					{...props}
				>
					{children}
					<TooltipPrimitive.Arrow className="z-50 size-2.5 rotate-45 rounded-[2px] bg-primary fill-primary" />
				</TooltipPrimitive.Popup>
			</TooltipPrimitive.Positioner>
		</TooltipPrimitive.Portal>
	);
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
