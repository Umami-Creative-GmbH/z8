"use client";
import { createContext } from "react";
/** A deferred slot has no RSC data read; active queries participate in client refresh. */
export const DashboardWidgetRefreshOwnerContext = createContext<"server" | "client">("server");
