"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const inputGroupButtonVariants = cva("text-sm shadow-none flex gap-2 items-center", {
	variants: {
		size: {
			xs: "h-6 gap-1 px-2 rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-3.5 has-[>svg]:px-2",
			sm: "h-8 px-2.5 gap-1.5 rounded-md has-[>svg]:px-2.5",
			"icon-xs": "size-6 rounded-[calc(var(--radius)-5px)] p-0 has-[>svg]:p-0",
			"icon-sm": "size-8 p-0 has-[>svg]:p-0",
		},
	},
	defaultVariants: {
		size: "xs",
	},
});

function InputGroupButton({
	className,
	type = "button",
	variant = "ghost",
	size = "xs",
	...props
}: Omit<React.ComponentProps<typeof Button>, "size"> &
	VariantProps<typeof inputGroupButtonVariants>) {
	return (
		<Button
			type={type}
			data-size={size}
			variant={variant}
			className={cn(inputGroupButtonVariants({ size }), className)}
			{...props}
		/>
	);
}

export { InputGroupButton };
