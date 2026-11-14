"use client";

import { IconArrowLeft } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { OrganizationBranding } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";

interface AuthFormWrapperProps extends React.ComponentPropsWithoutRef<"div"> {
	title: string;
	children: React.ReactNode;
	formProps?: React.ComponentPropsWithoutRef<"form">;
	branding?: OrganizationBranding | null;
	buildHash?: string;
	backHref?: string;
}

export function AuthFormWrapper({
	title,
	children,
	className,
	formProps,
	branding,
	buildHash,
	backHref,
	...props
}: AuthFormWrapperProps) {
	const { t } = useTranslate();
	const appName = branding?.appName || "z8";
	// Read the inlined value directly: importing `@/env` would ship every env schema to the auth pages.
	const visibleBuildHash = buildHash ?? process.env.NEXT_PUBLIC_BUILD_HASH;

	const customStyles = branding?.primaryColor
		? ({
				"--primary": branding.primaryColor,
				"--ring": branding.primaryColor,
			} as React.CSSProperties)
		: undefined;

	return (
		<div
			className={cn("mx-auto w-full max-w-md", className)}
			style={customStyles}
			{...props}
		>
			<Card className="relative w-full border-border bg-card shadow-sm">
				<CardContent className="p-5 sm:p-8">
					<form className="w-full" method="post" {...formProps}>
						<div className="flex flex-col gap-6">
							<div
								className={cn(
									"flex items-center gap-4",
									backHref ? "" : "justify-center",
								)}
							>
								{backHref ? (
									<Button asChild size="icon" variant="ghost">
										<Link href={backHref}>
											<IconArrowLeft className="size-4" />
											<span className="sr-only">
												{t("auth.wrapper.backToLogin", "Back to login")}
											</span>
										</Link>
									</Button>
								) : null}
								<div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center break-words">
									{branding?.logoUrl ? (
										<div className="relative mb-2 h-12 w-32">
											<Image
												alt={t("auth.wrapper.logo", "{appName} logo", {
													appName,
												})}
												className="object-contain"
												fill
												sizes="128px"
												src={branding.logoUrl}
											/>
										</div>
									) : (
										<p className="font-semibold text-sm text-muted-foreground">
											{appName}
										</p>
									)}
									<h1 className="text-balance text-2xl font-semibold tracking-tight">
										{title}
									</h1>
								</div>
								{backHref ? <div className="w-10" /> : null}
							</div>
							{children}
						</div>
					</form>
				</CardContent>
				{visibleBuildHash ? (
					<div className="absolute right-3 bottom-1.5 text-[10px] text-foreground/55">
						{t("auth.wrapper.version", "Version {version}", {
							version: visibleBuildHash,
						})}
					</div>
				) : null}
			</Card>
		</div>
	);
}
