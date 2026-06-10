"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { isValidElement } from "react";

type CollapsibleProps = ComponentProps<typeof CollapsiblePrimitive.Root> & {
	asChild?: boolean;
};

type CollapsibleRootRenderProps = HTMLAttributes<HTMLElement> & {
	children?: ReactNode;
};

function renderRootChildren({ children }: CollapsibleRootRenderProps) {
	return <>{children}</>;
}

export function Collapsible({ asChild, children, render, ...props }: CollapsibleProps) {
	const hasSingleChildRender = asChild && isValidElement(children);
	const baseRender = hasSingleChildRender
		? children
		: asChild
			? (render ?? renderRootChildren)
			: render;

	return (
		<CollapsiblePrimitive.Root data-slot="collapsible" render={baseRender} {...props}>
			{hasSingleChildRender ? null : children}
		</CollapsiblePrimitive.Root>
	);
}
