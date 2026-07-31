"use client";

import { createContext } from "react";

export const DashboardWidgetDraggableContext = createContext(true);

export const DashboardWidgetDraggableProvider =
	DashboardWidgetDraggableContext.Provider;
