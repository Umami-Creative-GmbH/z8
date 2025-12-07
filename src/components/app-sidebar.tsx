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
        title: t("Dashboard", { defaultValue: "Dashboard" }),
        url: "#",
        icon: IconDashboard,
      },
      {
        title: t("Lifecycle", { defaultValue: "Lifecycle" }),
        url: "#",
        icon: IconListDetails,
      },
      {
        title: t("Analytics", { defaultValue: "Analytics" }),
        url: "#",
        icon: IconChartBar,
      },
      {
        title: t("Projects", { defaultValue: "Projects" }),
        url: "#",
        icon: IconFolder,
      },
      {
        title: t("Team", { defaultValue: "Team" }),
        url: "#",
        icon: IconUsers,
      },
    ],
    navClouds: [
      {
        title: t("Capture", { defaultValue: "Capture" }),
        icon: IconCamera,
        isActive: true,
        url: "#",
        items: [
          {
            title: t("Active Proposals", { defaultValue: "Active Proposals" }),
            url: "#",
          },
          {
            title: t("Archived", { defaultValue: "Archived" }),
            url: "#",
          },
        ],
      },
      {
        title: t("Proposal", { defaultValue: "Proposal" }),
        icon: IconFileDescription,
        url: "#",
        items: [
          {
            title: t("Active Proposals", { defaultValue: "Active Proposals" }),
            url: "#",
          },
          {
            title: t("Archived", { defaultValue: "Archived" }),
            url: "#",
          },
        ],
      },
      {
        title: t("Prompts", { defaultValue: "Prompts" }),
        icon: IconFileAi,
        url: "#",
        items: [
          {
            title: t("Active Proposals", { defaultValue: "Active Proposals" }),
            url: "#",
          },
          {
            title: t("Archived", { defaultValue: "Archived" }),
            url: "#",
          },
        ],
      },
    ],
    navSecondary: [
      {
        title: t("Settings", { defaultValue: "Settings" }),
        url: "#",
        icon: IconSettings,
      },
      {
        title: t("Get Help", { defaultValue: "Get Help" }),
        url: "#",
        icon: IconHelp,
      },
      {
        title: t("Search", { defaultValue: "Search" }),
        url: "#",
        icon: IconSearch,
      },
    ],
    documents: [
      {
        name: t("Data Library", { defaultValue: "Data Library" }),
        url: "#",
        icon: IconDatabase,
      },
      {
        name: t("Reports", { defaultValue: "Reports" }),
        url: "#",
        icon: IconReport,
      },
      {
        name: t("Word Assistant", { defaultValue: "Word Assistant" }),
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
