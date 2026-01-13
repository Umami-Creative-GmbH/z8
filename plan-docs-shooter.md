# Documentation Screenshot Automation

A universal, reusable plan for automatically capturing and updating screenshots across all Z8 documentation.

## Prerequisites
- Dev server running at `localhost:3000`
- Demo data populated in the app
- Browser automation available

---

## Abstract Workflow

### Step 1: Discover Documentation Pages
1. Scan all MDX files in `apps/docs/content/docs/guide/`
2. For each MDX file, identify:
   - The feature/page it documents (from title/content)
   - The corresponding app route

### Step 2: Map Features to App Routes
Use the sidebar navigation structure to map documentation to app pages:

| Doc Section | App Route Pattern |
|-------------|-------------------|
| User Guide | Main nav items: `/en/{feature}` |
| Admin Guide | Settings pages: `/en/settings/{feature}` |
| Getting Started | Profile/onboarding pages |

### Step 3: Screenshot Capture Process
For each documented feature:
1. Navigate to the corresponding app route
2. **Wait for full page load** (no loading spinners visible)
3. Take full-page screenshot
4. If the doc mentions interactive elements (popovers, dialogs, forms):
   - Click to open the element
   - Wait for animation/load
   - Take additional screenshot
5. Save screenshots to `apps/docs/public/images/{section}/`

### Step 4: Update Documentation
For each captured screenshot:
1. Add image reference to the relevant MDX file
2. Place images near the text that describes them
3. Use descriptive alt text

---

## Directory Structure
```
apps/docs/public/images/
├── user-guide/      # Screenshots for user-facing features
├── admin-guide/     # Screenshots for admin/settings pages
└── getting-started/ # Screenshots for onboarding flows
```

## Naming Convention
- `{feature}-page.png` - Full page screenshots
- `{feature}-{element}.png` - Specific UI elements (popovers, dialogs)
- Use kebab-case, lowercase

## MDX Image Syntax
```mdx
![Feature Description](/images/{section}/{feature}.png)
```

---

## Discovery Rules

### Identify App Routes from Documentation
1. Look for navigation references: "Go to **X** → **Y**"
2. Look for settings references: "Go to **Settings** → **Feature**"
3. Look for action references: "Click **Button Name**"

### Identify Interactive Elements
Capture additional screenshots when docs mention:
- Popovers or dropdowns
- Dialog boxes or modals
- Forms or input flows
- Multi-step processes

---

## Execution Guidelines

1. **Read each MDX file** to understand what it documents
2. **Navigate to the app** at the corresponding route
3. **Wait for content** - ensure all data is loaded, no spinners
4. **Capture main view** - full page screenshot
5. **Capture interactions** - if docs describe clicking something, do it and screenshot
6. **Save with clear names** - match the feature being documented
7. **Update the MDX** - add image references where relevant

---

## Adding to New Features

When new documentation is added:
1. Run this workflow on the new MDX file
2. Identify its corresponding app route
3. Capture screenshots following the same process
4. Images auto-integrate with existing structure

---

## Notes
- Base URL: `http://localhost:3000/en/`
- Always use English locale (`/en/`) for consistency
- Ensure browser window is appropriately sized for clear screenshots
