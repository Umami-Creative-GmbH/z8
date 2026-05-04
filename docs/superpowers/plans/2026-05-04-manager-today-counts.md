# Manager Today Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static Manager Today dashboard body with a compact, data-backed summary from the existing Manager Daily Briefing counts.

**Architecture:** Add a small dashboard server action that resolves the current employee and returns a dashboard-shaped summary for managers/admins. Keep count aggregation in a pure helper colocated with the widget so it is easy to test. Update the client widget to render a two-by-two count grid, an all-clear message, and an inline error state while preserving role-based hiding.

**Tech Stack:** Next.js server actions, React client components, TanStack Query, Tolgee, Vitest, React Testing Library, Luxon through the existing briefing loader.

---

See the controller session for the task-by-task execution details. Commits are intentionally skipped unless explicitly requested by the user.
