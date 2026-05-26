"use client";

import * as TogglePrimitive from "@radix-ui/react-toggle";
import type { VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { toggleVariants } from "./toggle-variants";

function Toggle({
	className,
	variant,
	size,
	...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
	return (
		<TogglePrimitive.Root
			className={cn(toggleVariants({ variant, size, className }))}
			data-slot="toggle"
			{...props}
		/>
	);
}

export { Toggle };
