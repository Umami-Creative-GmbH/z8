"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import type { ComponentProps } from "react";
import { isValidElement } from "react";

type CollapsibleContentProps = ComponentProps<typeof CollapsiblePrimitive.Panel> & {
	asChild?: boolean;
};

export function CollapsibleContent({ asChild, children, render, ...props }: CollapsibleContentProps) {
	const baseRender = asChild && isValidElement(children) ? children : render;

	return (
		<CollapsiblePrimitive.Panel data-slot="collapsible-content" render={baseRender} {...props}>
			{asChild ? null : children}
		</CollapsiblePrimitive.Panel>
	);
}
