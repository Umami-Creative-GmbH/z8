"use client";

import Image from "next/image";
import { IconArrowLeft } from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
	const appName = branding?.appName || "z8";
	const visibleBuildHash = buildHash ?? process.env.NEXT_PUBLIC_BUILD_HASH;

	const customStyles = branding?.primaryColor
		? ({
				"--primary": branding.primaryColor,
				"--ring": branding.primaryColor,
			} as React.CSSProperties)
		: undefined;

	return (
		<div className={cn("mx-auto w-full max-w-md", className)} style={customStyles} {...props}>
			<Card className="relative w-full border-white/30 bg-white/20 shadow-xl shadow-black/5 backdrop-blur-[40px] sm:shadow-xl dark:border-white/10 dark:bg-slate-950/20 dark:shadow-black/30 [&_.text-muted-foreground]:text-foreground/75 [&_[data-slot=input]]:bg-background/85 dark:[&_[data-slot=input]]:bg-background/80">
				<CardContent className="p-5 sm:p-8">
					<form className="w-full" method="post" {...formProps}>
						<div className="flex flex-col gap-6">
							<div className={cn("flex items-center gap-4", backHref ? "" : "justify-center")}>
								{backHref ? (
									<Button asChild size="icon" variant="ghost">
										<Link href={backHref}>
											<IconArrowLeft className="size-4" />
											<span className="sr-only">Back to login</span>
										</Link>
									</Button>
								) : null}
								<div className="flex flex-1 flex-col items-center text-center">
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
								{backHref ? <div className="w-10" /> : null}
							</div>
							{children}
						</div>
					</form>
				</CardContent>
				{visibleBuildHash ? (
					<div className="absolute right-3 bottom-1.5 text-[10px] text-foreground/55">
						Version {visibleBuildHash}
					</div>
				) : null}
			</Card>
		</div>
	);
}
