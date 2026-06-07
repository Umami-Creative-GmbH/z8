import type { VariantProps } from "class-variance-authority";
import type * as React from "react";

import { markNativeButtonComponent } from "@/components/ui/base-ui-compat";
import { buttonVariants } from "@/components/ui/button-variants";
import { Slot } from "@/components/ui/slot";
import { cn } from "@/lib/utils";

function Button({
	className,
	variant,
	size,
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot : "button";

	return (
		<Comp
			className={cn(buttonVariants({ variant, size, className }))}
			data-slot="button"
			{...props}
		/>
	);
}

markNativeButtonComponent(Button);

export { Button };
