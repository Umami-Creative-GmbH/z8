"use client";

import { useTranslate } from "@tolgee/react";
import Image from "next/image";
import bgImage from "@/../public/ally-griffin-3hsrEvJi_gw-unsplash.jpg";
import { Card, CardContent } from "@/components/ui/card";
import type { OrganizationBranding } from "@/lib/domain";
import { cn } from "@/lib/utils";

interface AuthFormWrapperProps extends React.ComponentProps<"div"> {
	title: string;
	children: React.ReactNode;
	formProps?: React.ComponentProps<"form">;
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
	const { t } = useTranslate();
	const appName = branding?.appName || "z8";

	const customStyles = branding?.primaryColor
		? ({
				"--primary": branding.primaryColor,
				"--ring": branding.primaryColor,
			} as React.CSSProperties)
		: undefined;

	return (
		<div
			className={cn(
				"flex items-center justify-center px-4 py-8 sm:px-6 lg:px-8",
				className,
			)}
			style={customStyles}
			{...props}
		>
			<Card className="w-full max-w-5xl overflow-hidden border-border/70 bg-card/95 p-0 shadow-xl">
				<CardContent className="p-0 md:grid md:grid-cols-2">
					<form className="w-full bg-card p-6 md:p-8" method="post" {...formProps}>
						<div className="flex flex-col gap-6">
							<div className="flex flex-col items-center text-center">
								{branding?.logoUrl ? (
									<div className="relative mb-2 h-12 w-32">
										<Image
											alt={`${appName} logo`}
											className="object-contain"
											fill
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
					<div className="relative hidden bg-muted md:block">
						{branding?.backgroundImageUrl ? (
							<Image
								alt={`${appName} background`}
								fill
								priority
								quality={85}
								sizes="50vw"
								src={branding.backgroundImageUrl}
								style={{ objectFit: "cover" }}
							/>
						) : (
							<Image
								alt={t(
									"common.background-image-alt",
									"Background Image - Foto von Ally Griffin auf Unsplash",
								)}
								fill
								placeholder="blur"
								priority
								quality={75}
								sizes="50vw"
								src={bgImage}
								style={{ objectFit: "cover" }}
							/>
						)}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
