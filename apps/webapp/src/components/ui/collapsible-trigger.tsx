"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import type { ComponentProps } from "react";
import { isValidElement } from "react";

import { Button } from "@/components/ui/button";

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

export function CollapsibleTrigger({
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
