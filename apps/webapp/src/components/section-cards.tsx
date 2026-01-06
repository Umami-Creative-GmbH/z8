"use client";

import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardAction,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export function SectionCards() {
	const { t } = useTranslate();
	return (
		<div className="grid @5xl/main:grid-cols-4 @xl/main:grid-cols-2 grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 dark:*:data-[slot=card]:bg-card">
			<Card className="@container/card">
				<CardHeader>
					<CardDescription>{t("dashboard.cards.revenue.total", "Total Revenue")}</CardDescription>
					<CardTitle className="font-semibold @[250px]/card:text-3xl text-2xl tabular-nums">
						$1,250.00
					</CardTitle>
					<CardAction>
						<Badge variant="outline">
							<IconTrendingUp />
							+12.5%
						</Badge>
					</CardAction>
				</CardHeader>
				<CardFooter className="flex-col items-start gap-1.5 text-sm">
					<div className="line-clamp-1 flex gap-2 font-medium">
						{t("dashboard.cards.revenue.trending-up", "Trending up this month")}{" "}
						<IconTrendingUp className="size-4" />
					</div>
					<div className="text-muted-foreground">
						{t("dashboard.cards.revenue.visitors", "Visitors for the last 6 months")}
					</div>
				</CardFooter>
			</Card>
			<Card className="@container/card">
				<CardHeader>
					<CardDescription>{t("dashboard.cards.customers.new", "New Customers")}</CardDescription>
					<CardTitle className="font-semibold @[250px]/card:text-3xl text-2xl tabular-nums">
						1,234
					</CardTitle>
					<CardAction>
						<Badge variant="outline">
							<IconTrendingDown />
							-20%
						</Badge>
					</CardAction>
				</CardHeader>
				<CardFooter className="flex-col items-start gap-1.5 text-sm">
					<div className="line-clamp-1 flex gap-2 font-medium">
						{t("dashboard.cards.customers.down", "Down 20% this period")}{" "}
						<IconTrendingDown className="size-4" />
					</div>
					<div className="text-muted-foreground">
						{t("dashboard.cards.customers.acquisition", "Acquisition needs attention")}
					</div>
				</CardFooter>
			</Card>
			<Card className="@container/card">
				<CardHeader>
					<CardDescription>
						{t("dashboard.cards.accounts.active", "Active Accounts")}
					</CardDescription>
					<CardTitle className="font-semibold @[250px]/card:text-3xl text-2xl tabular-nums">
						45,678
					</CardTitle>
					<CardAction>
						<Badge variant="outline">
							<IconTrendingUp />
							+12.5%
						</Badge>
					</CardAction>
				</CardHeader>
				<CardFooter className="flex-col items-start gap-1.5 text-sm">
					<div className="line-clamp-1 flex gap-2 font-medium">
						{t("dashboard.cards.accounts.retention", "Strong user retention")}{" "}
						<IconTrendingUp className="size-4" />
					</div>
					<div className="text-muted-foreground">
						{t("dashboard.cards.accounts.engagement", "Engagement exceed targets")}
					</div>
				</CardFooter>
			</Card>
			<Card className="@container/card">
				<CardHeader>
					<CardDescription>{t("dashboard.cards.growth.rate", "Growth Rate")}</CardDescription>
					<CardTitle className="font-semibold @[250px]/card:text-3xl text-2xl tabular-nums">
						4.5%
					</CardTitle>
					<CardAction>
						<Badge variant="outline">
							<IconTrendingUp />
							+4.5%
						</Badge>
					</CardAction>
				</CardHeader>
				<CardFooter className="flex-col items-start gap-1.5 text-sm">
					<div className="line-clamp-1 flex gap-2 font-medium">
						{t("dashboard.cards.growth.increase", "Steady performance increase")}{" "}
						<IconTrendingUp className="size-4" />
					</div>
					<div className="text-muted-foreground">
						{t("dashboard.cards.growth.projections", "Meets growth projections")}
					</div>
				</CardFooter>
			</Card>
		</div>
	);
}
