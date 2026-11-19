import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Presentation only. The page supplies translated task/scope and owns every action. */
export function PageHeader({
	title,
	description,
	scope,
	actions,
	className,
	...props
}: Omit<ComponentProps<"div">, "title"> & {
	title: ReactNode;
	description?: ReactNode;
	scope?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-end justify-between gap-4",
				className,
			)}
			{...props}
		>
			<div className="min-w-0 flex-[1_1_18rem] space-y-2 break-words">
				{scope ? (
					<div className="text-sm text-muted-foreground">{scope}</div>
				) : null}
				<h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
					{title}
				</h1>
				{description ? (
					<div className="max-w-3xl text-pretty text-sm text-muted-foreground">
						{description}
					</div>
				) : null}
			</div>
			{actions ? (
				<div className="flex max-w-full flex-wrap items-center gap-2">
					{actions}
				</div>
			) : null}
		</div>
	);
}
