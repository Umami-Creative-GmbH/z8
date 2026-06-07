"use client";

import { PreviewCard as HoverCardPrimitive } from "@base-ui/react/preview-card";
import * as React from "react";

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

export { HoverCardTrigger };
