"use client";

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import type * as React from "react";

import { cn } from "@/lib/utils";

type SeparatorProps = Omit<React.ComponentProps<typeof SeparatorPrimitive>, "className"> & {
	className?: string;
	decorative?: boolean;
};

function Separator({
	className,
	orientation = "horizontal",
	decorative = true,
	role,
	...props
}: SeparatorProps) {
	return (
		<SeparatorPrimitive
			className={cn(
				"shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px",
				className,
			)}
			data-orientation={orientation}
			data-slot="separator"
			orientation={orientation}
			role={decorative ? "none" : role}
			{...props}
		/>
	);
}

export { Separator };
