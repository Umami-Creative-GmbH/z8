"use client";

import {
	IconChevronLeft,
	IconChevronRight,
	IconDots,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type * as React from "react";
import type { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
	const { t } = useTranslate();
	return (
		<nav
			aria-label={t("common.pagination.pagination", "pagination")}
			data-slot="pagination"
			className={cn("mx-auto flex w-full justify-center", className)}
			{...props}
		/>
	);
}

function PaginationContent({
	className,
	...props
}: React.ComponentProps<"ul">) {
	return (
		<ul
			data-slot="pagination-content"
			className={cn("flex flex-row items-center gap-1", className)}
			{...props}
		/>
	);
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
	return <li data-slot="pagination-item" {...props} />;
}

type PaginationLinkProps = {
	isActive?: boolean;
	href: string;
} & Pick<React.ComponentProps<typeof Button>, "size"> &
	Omit<React.ComponentProps<"a">, "href">;

function PaginationLink({
	className,
	children,
	isActive,
	size = "icon",
	href,
	...props
}: PaginationLinkProps) {
	return (
		<a
			href={href}
			aria-current={isActive ? "page" : undefined}
			data-slot="pagination-link"
			data-active={isActive}
			className={cn(
				buttonVariants({
					variant: isActive ? "outline" : "ghost",
					size,
				}),
				className,
			)}
			{...props}
		>
			{children}
		</a>
	);
}

function PaginationPrevious({
	className,
	...props
}: React.ComponentProps<typeof PaginationLink>) {
	const { t } = useTranslate();
	return (
		<PaginationLink
			aria-label={t(
				"common.pagination.goToPreviousPage",
				"Go to previous page",
			)}
			size="default"
			className={cn("gap-1 px-2.5 sm:pl-2.5", className)}
			{...props}
		>
			<IconChevronLeft />
			<span className="hidden sm:block">
				{t("common.previous", "Previous")}
			</span>
		</PaginationLink>
	);
}

function PaginationNext({
	className,
	...props
}: React.ComponentProps<typeof PaginationLink>) {
	const { t } = useTranslate();
	return (
		<PaginationLink
			aria-label={t("common.pagination.goToNextPage", "Go to next page")}
			size="default"
			className={cn("gap-1 px-2.5 sm:pr-2.5", className)}
			{...props}
		>
			<span className="hidden sm:block">{t("common.next", "Next")}</span>
			<IconChevronRight />
		</PaginationLink>
	);
}

function PaginationEllipsis({
	className,
	...props
}: React.ComponentProps<"span">) {
	const { t } = useTranslate();
	return (
		<span
			aria-hidden
			data-slot="pagination-ellipsis"
			className={cn("flex size-9 items-center justify-center", className)}
			{...props}
		>
			<IconDots className="size-4" />
			<span className="sr-only">
				{t("common.pagination.morePages", "More pages")}
			</span>
		</span>
	);
}

export {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
};
