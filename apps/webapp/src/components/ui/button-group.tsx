import type { VariantProps } from "class-variance-authority";
import { Separator } from "@/components/ui/separator";
import { Slot } from "@/components/ui/slot";
import { cn } from "@/lib/utils";
import { buttonGroupVariants } from "./button-group-variants";

function ButtonGroup({
	className,
	orientation,
	...props
}: React.ComponentProps<"fieldset"> & VariantProps<typeof buttonGroupVariants>) {
	return (
		<fieldset
			data-slot="button-group"
			data-orientation={orientation}
			className={cn("m-0 min-w-0 border-0 p-0", buttonGroupVariants({ orientation }), className)}
			{...props}
		/>
	);
}

function ButtonGroupText({
	className,
	asChild = false,
	...props
}: React.ComponentProps<"div"> & {
	asChild?: boolean;
}) {
	const Comp = asChild ? Slot : "div";

	return (
		<Comp
			className={cn(
				"bg-muted flex items-center gap-2 rounded-md border px-4 text-sm font-medium shadow-xs [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		/>
	);
}

function ButtonGroupSeparator({
	className,
	orientation = "vertical",
	...props
}: React.ComponentProps<typeof Separator>) {
	return (
		<Separator
			data-slot="button-group-separator"
			orientation={orientation}
			className={cn(
				"bg-input relative !m-0 self-stretch data-[orientation=vertical]:h-auto",
				className,
			)}
			{...props}
		/>
	);
}

export { ButtonGroup, ButtonGroupSeparator, ButtonGroupText };
