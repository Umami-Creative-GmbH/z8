"use client";

import {
  IconCamera,
  IconChartBar,
  IconDashboard,
  IconDatabase,
  IconFileAi,
  IconFileDescription,
  IconFileWord,
  IconFolder,
  IconHelp,
  IconListDetails,
  IconReport,
  IconSearch,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { Clock } from "lucide-react";
import type * as React from "react";
import { useTranslate } from "@tolgee/react";
import { NavDocuments } from "@/components/nav-documents";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslate();

  const data = {
    user: {
      name: "shadcn",
      email: "m@example.com",
      avatar: "/avatars/shadcn.jpg",
    },
    navMain: [
      {
        title: t("nav.dashboard", "Dashboard"),
        url: "#",
        icon: IconDashboard,
      },
      {
        title: t("nav.lifecycle", "Lifecycle"),
        url: "#",
        icon: IconListDetails,
      },
      {
        title: t("nav.analytics", "Analytics"),
        url: "#",
        icon: IconChartBar,
      },
      {
        title: t("nav.projects", "Projects"),
        url: "#",
        icon: IconFolder,
      },
      {
        title: t("nav.team", "Team"),
        url: "#",
        icon: IconUsers,
      },
    ],
    navClouds: [
      {
        title: t("nav.capture", "Capture"),
        icon: IconCamera,
        isActive: true,
        url: "#",
        items: [
          {
            title: t("nav.active-proposals", "Active Proposals"),
            url: "#",
          },
          {
            title: t("nav.archived", "Archived"),
            url: "#",
          },
        ],
      },
      {
        title: t("nav.proposal", "Proposal"),
        icon: IconFileDescription,
        url: "#",
        items: [
          {
            title: t("nav.active-proposals", "Active Proposals"),
            url: "#",
          },
          {
            title: t("nav.archived", "Archived"),
            url: "#",
          },
        ],
      },
      {
        title: t("nav.prompts", "Prompts"),
        icon: IconFileAi,
        url: "#",
        items: [
          {
            title: t("nav.active-proposals", "Active Proposals"),
            url: "#",
          },
          {
            title: t("nav.archived", "Archived"),
            url: "#",
          },
        ],
      },
    ],
    navSecondary: [
      {
        title: t("nav.settings", "Settings"),
        url: "#",
        icon: IconSettings,
      },
      {
        title: t("nav.get-help", "Get Help"),
        url: "#",
        icon: IconHelp,
      },
      {
        title: t("nav.search", "Search"),
        url: "#",
        icon: IconSearch,
      },
    ],
    documents: [
      {
        name: t("nav.data-library", "Data Library"),
        url: "#",
        icon: IconDatabase,
      },
      {
        name: t("nav.reports", "Reports"),
        url: "#",
        icon: IconReport,
      },
      {
        name: t("nav.word-assistant", "Word Assistant"),
        url: "#",
        icon: IconFileWord,
      },
    ],
  };
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <a href="#">
                <Clock className="!size-5" />
                <span className="font-semibold text-base">z8</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavDocuments items={data.documents} />
        <NavSecondary className="mt-auto" items={data.navSecondary} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  );
}
