"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import type { VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { toggleVariants } from "./toggle-variants";

function Toggle({
	className,
	variant,
	size,
	...props
}: React.ComponentProps<typeof TogglePrimitive> & VariantProps<typeof toggleVariants>) {
	return (
		<TogglePrimitive
			className={cn(toggleVariants({ variant, size, className }))}
			data-slot="toggle"
			{...props}
		/>
	);
}

export { Toggle };
