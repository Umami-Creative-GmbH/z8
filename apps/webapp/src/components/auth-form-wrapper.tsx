"use client";

import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import type { OrganizationBranding } from "@/lib/domain";
import { cn } from "@/lib/utils";

interface AuthFormWrapperProps extends React.ComponentPropsWithoutRef<"div"> {
	title: string;
	children: React.ReactNode;
	formProps?: React.ComponentPropsWithoutRef<"form">;
	branding?: OrganizationBranding | null;
}

export function AuthFormWrapper({
	title,
	children,
	className,
	formProps,
	branding,
	...props
}: AuthFormWrapperProps) {
	const appName = branding?.appName || "z8";

	const customStyles = branding?.primaryColor
		? ({
				"--primary": branding.primaryColor,
				"--ring": branding.primaryColor,
			} as React.CSSProperties)
		: undefined;

	return (
		<div className={cn("w-full", className)} style={customStyles} {...props}>
			<Card className="w-full border-border/70 bg-card/95 shadow-xl shadow-black/5 dark:shadow-black/30">
				<CardContent className="p-6 sm:p-8">
					<form className="w-full" method="post" {...formProps}>
						<div className="flex flex-col gap-6">
							<div className="flex flex-col items-center text-center">
								{branding?.logoUrl ? (
									<div className="relative mb-2 h-12 w-32">
										<Image
											alt={`${appName} logo`}
											className="object-contain"
											fill
											sizes="128px"
											src={branding.logoUrl}
										/>
									</div>
								) : (
									<h1 className="font-bold text-2xl">{appName}</h1>
								)}
								<p className="text-balance text-muted-foreground">{title}</p>
							</div>
							{children}
						</div>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
