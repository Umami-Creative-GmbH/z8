# README WIP Disclaimer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a short top-of-file disclaimer to `README.md` that states the project is still WIP, notes current company usage, calls out limited export-testing coverage, and directs users to GitHub issues for bug reports.

**Architecture:** Keep this as a single-file documentation edit. Insert one compact block directly below the README introduction so the disclaimer is visible before the feature sections, while leaving the rest of the document unchanged.

**Tech Stack:** Markdown, Git, ripgrep

---

## File Structure

- Modify: `README.md`
  Purpose: add one visible disclaimer block below the intro paragraph and above the first section divider.

### Task 1: Add The Top-Level WIP Disclaimer To `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the failing placement check**

```bash
rg -n '## WIP Notice|still a work in progress|open a GitHub issue' README.md
```

- [ ] **Step 2: Run the placement check to verify it fails before editing**

Run: `rg -n '## WIP Notice|still a work in progress|open a GitHub issue' README.md`
Expected: no matches yet, so the command exits with status `1`.

- [ ] **Step 3: Insert the disclaimer block below the opening summary**

```md
# Z8 - Workforce Management for Audit-Ready Operations

Z8 is a workforce management platform built for organizations that need reliable time tracking, audit-ready records, and clear operational control under German labor law and GoBD compliance (*Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern*).

Across Web, Mobile, and Desktop, Z8 gives teams a dependable operational system for time tracking, absences, travel expenses, and day-to-day workforce management.

## WIP Notice

Z8 is still a work in progress. It is already used by several companies of different sizes, but some parts of the product may still change as the platform continues to mature.

Not all export options have been tested in all circumstances yet. If you run into a bug, an export edge case, or other unexpected behavior, please open a GitHub issue.

---
```

- [ ] **Step 4: Re-run the placement check to verify the disclaimer is present**

Run: `rg -n '## WIP Notice|still a work in progress|open a GitHub issue' README.md`
Expected: matches for the new heading and both disclaimer paragraphs.

- [ ] **Step 5: Review the top of the README for final wording and position**

Run: `git diff -- README.md`
Expected: a single hunk that inserts the disclaimer block between the intro text and the first `---` divider, with no unrelated README edits.

- [ ] **Step 6: Commit the README disclaimer change**

```bash
git add README.md
git commit -m "docs: add README WIP disclaimer"
```
