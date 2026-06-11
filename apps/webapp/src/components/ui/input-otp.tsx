"use client";

import { OTPInput } from "input-otp";
import type * as React from "react";

import { InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp-parts";
import { cn } from "@/lib/utils";

function InputOTP({
	className,
	containerClassName,
	...props
}: React.ComponentProps<typeof OTPInput> & {
	containerClassName?: string;
}) {
	return (
		<OTPInput
			data-slot="input-otp"
			containerClassName={cn("flex items-center gap-2 has-disabled:opacity-50", containerClassName)}
			className={cn("disabled:cursor-not-allowed", className)}
			{...props}
		/>
	);
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div data-slot="input-otp-group" className={cn("flex items-center", className)} {...props} />
	);
}

export { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot };
