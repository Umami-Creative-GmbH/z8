"use client";

import { OTPInputContext } from "input-otp";
import * as React from "react";

import { cn } from "@/lib/utils";

function InputOTPSlot({
	index,
	className,
	...props
}: React.ComponentProps<"div"> & {
	index: number;
}) {
	const inputOTPContext = React.use(OTPInputContext);
	const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {};

	return (
		<div
			data-slot="input-otp-slot"
			data-active={isActive}
			className={cn(
				"data-[active=true]:border-ring data-[active=true]:ring-ring/50 data-[active=true]:aria-invalid:ring-destructive/20 dark:data-[active=true]:aria-invalid:ring-destructive/40 aria-invalid:border-destructive data-[active=true]:aria-invalid:border-destructive border-input relative flex size-9 items-center justify-center border-y border-r bg-card text-sm shadow-xs transition-[border-color,box-shadow] outline-none first:rounded-l-md first:border-l last:rounded-r-md data-[active=true]:z-10 data-[active=true]:ring-[3px] dark:bg-input/30",
				className,
			)}
			{...props}
		>
			{char}
			{hasFakeCaret && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<div className="animate-caret-blink bg-foreground h-4 w-px duration-1000" />
				</div>
			)}
		</div>
	);
}

function InputOTPSeparator({ className, ...props }: React.ComponentProps<"hr">) {
	return (
		<hr
			data-slot="input-otp-separator"
			className={cn("w-4 border-border", className)}
			{...props}
		/>
	);
}

export { InputOTPSeparator, InputOTPSlot };
