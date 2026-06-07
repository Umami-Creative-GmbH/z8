import type { VariantProps } from "class-variance-authority";
import type * as React from "react";

import { badgeVariants } from "@/components/ui/badge-variants";
import { Slot } from "@/components/ui/slot";
import { cn } from "@/lib/utils";

function Badge({
	className,
	variant,
	asChild = false,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot : "span";

	return (
		<Comp className={cn(badgeVariants({ variant }), className)} data-slot="badge" {...props} />
	);
}

export { Badge };
