"use client";

import { useTranslate } from "@tolgee/react";
import Image from "next/image";
import bgImage from "@/../public/ally-griffin-3hsrEvJi_gw-unsplash.jpg";
import { Card, CardContent } from "@/components/ui/card";
import type { OrganizationBranding } from "@/lib/domain";
import { cn } from "@/lib/utils";
import QuoteBox from "./ui/quote-box";

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

	// Determine what to display
	const appName = branding?.appName || "z8";
	const showQuotes = branding?.quotesEnabled ?? true;
	const customQuotes = branding?.customQuotes;

	// Generate custom CSS for primary color
	const customStyles = branding?.primaryColor
		? ({
				"--primary": branding.primaryColor,
				"--ring": branding.primaryColor,
			} as React.CSSProperties)
		: undefined;

	return (
		<div className={cn("flex flex-col gap-6", className)} style={customStyles} {...props}>
			<Card className="overflow-hidden p-0">
				<CardContent className="relative p-0">
					<form
						className="relative z-20 w-full bg-card p-6 md:w-1/2 md:p-8"
						method="post"
						{...formProps}
					>
						<div className="flex flex-col gap-6">
							<div className="flex flex-col items-center text-center">
								{branding?.logoUrl ? (
									<div className="relative h-12 w-32 mb-2">
										<Image
											src={branding.logoUrl}
											alt={`${appName} logo`}
											fill
											className="object-contain"
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
					<div className="absolute inset-0 z-10 bg-muted">
						{branding?.backgroundImageUrl ? (
							<Image
								alt={`${appName} background`}
								fill
								quality={85}
								sizes="100vw"
								src={branding.backgroundImageUrl}
								style={{
									objectFit: "cover",
								}}
							/>
						) : (
							<Image
								alt={t(
									"common.background-image-alt",
									"Background Image - Foto von Ally Griffin auf Unsplash",
								)}
								fill
								placeholder="blur"
								quality={75}
								sizes="100vw"
								src={bgImage}
								style={{
									objectFit: "cover",
								}}
							/>
						)}
						<div className="hidden md:block">
							<QuoteBox enabled={showQuotes} customQuotes={customQuotes} />
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
