"use client";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type * as React from "react";

import { cn } from "@/lib/utils";

type ProgressProps = Omit<
	React.ComponentProps<typeof ProgressPrimitive.Root>,
	"className" | "value"
> & {
	className?: string;
	value?: number | null;
};

function Progress({ className, value, ...props }: ProgressProps) {
	return (
		<ProgressPrimitive.Root
			data-slot="progress"
			className={cn("bg-primary/20 relative h-2 w-full overflow-hidden rounded-full", className)}
			value={value ?? null}
			{...props}
		>
			<ProgressPrimitive.Indicator
				data-slot="progress-indicator"
				className="bg-primary size-full flex-1 transition-transform"
				style={{ width: "100%", transform: `translateX(-${100 - (value || 0)}%)` }}
			/>
		</ProgressPrimitive.Root>
	);
}

export { Progress };
