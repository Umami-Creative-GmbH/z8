"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import type { ComponentProps, HTMLAttributes, ReactElement, ReactNode } from "react";
import { isValidElement } from "react";

import { Button } from "@/components/ui/button";

type CollapsibleProps = ComponentProps<typeof CollapsiblePrimitive.Root> & {
	asChild?: boolean;
};

type CollapsibleRootRenderProps = HTMLAttributes<HTMLElement> & {
	children?: ReactNode;
};

function renderRootChildren({ children }: CollapsibleRootRenderProps) {
	return <>{children}</>;
}

function Collapsible({ asChild, children, render, ...props }: CollapsibleProps) {
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

type CollapsibleTriggerProps = ComponentProps<typeof CollapsiblePrimitive.Trigger> & {
	asChild?: boolean;
};

function getAsChildNativeButton(
	asChild: boolean | undefined,
	children: CollapsibleTriggerProps["children"],
	nativeButton: CollapsibleTriggerProps["nativeButton"],
) {
	if (nativeButton !== undefined) {
		return nativeButton;
	}

	if (asChild && isValidElement(children)) {
		if (children.type === "button") {
			return true;
		}

		if (children.type === Button && (children.props as { asChild?: boolean }).asChild !== true) {
			return true;
		}

		return false;
	}

	return nativeButton;
}

function CollapsibleTrigger({
	asChild,
	children,
	nativeButton,
	render,
	...props
}: CollapsibleTriggerProps) {
	const baseRender: CollapsibleTriggerProps["render"] =
		asChild && isValidElement(children) ? children : render;
	const resolvedNativeButton = getAsChildNativeButton(asChild, children, nativeButton);

	return (
		<CollapsiblePrimitive.Trigger
			data-slot="collapsible-trigger"
			nativeButton={resolvedNativeButton}
			render={baseRender}
			{...props}
		>
			{asChild ? null : children}
		</CollapsiblePrimitive.Trigger>
	);
}

type CollapsibleContentProps = ComponentProps<typeof CollapsiblePrimitive.Panel> & {
	asChild?: boolean;
};

function CollapsibleContent({
	asChild,
	children,
	render,
	...props
}: CollapsibleContentProps) {
	const baseRender = asChild && isValidElement(children) ? children : render;

	return (
		<CollapsiblePrimitive.Panel
			data-slot="collapsible-content"
			render={baseRender}
			{...props}
		>
			{asChild ? null : children}
		</CollapsiblePrimitive.Panel>
	);
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
