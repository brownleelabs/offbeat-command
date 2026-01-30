# Dashboard UI Vocabulary

Shared terminology for describing dashboard elements to enable rapid UI changes.

## Top-to-Bottom Structure

### 1. **View Mode Banner** (or "Mode Banner")
- **Location**: Top of page, below body tag
- **Purpose**: Shows current view context (GLOBAL/TENANT toggle for SUPER_ADMIN, or Organization name for others)
- **Current styling**: `border-b border-accent/20 bg-muted p-2 text-center`
- **Code location**: `dashboard-client.tsx` lines 410-425
- **Variants**:
  - SUPER_ADMIN: Clickable toggle button
  - Non-SUPER_ADMIN: Read-only organization name

### 2. **Navigation Bar** (or "Nav Bar", "Header")
- **Location**: Sticky below View Mode Banner
- **Purpose**: Primary navigation with title, tabs, and logout
- **Current styling**: `sticky top-0 z-50 flex items-center justify-between border-b border-accent bg-muted px-8 py-4`
- **Code location**: `dashboard-client.tsx` lines 426-482
- **Contains**:
  - **Title**: "Campus Mobility Project Control Center"
  - **Tab Group**: MAP, FLEET, CAMPAIGNS, SETTINGS (pill-shaped button group)
  - **Right Side**: LOGOUT button + version number

### 3. **Executive Stats Banner** (or "Stats Banner", "Metrics Bar")
- **Location**: Below Nav Bar, above main content
- **Purpose**: Identity (who you are: email, role, org) + persistent financial/operational metrics + **Command Center** (Total Yield Disbursed, Active Assets) on the far right; all consistent across tabs
- **Current styling**: Single row, `px-4 py-3` (compact), flex wrap; **You are** (no border) on left; stat pills with % change (green positive, red negative); **Command Center** block on far right with "Live" indicator and subtle pulse on numbers
- **Code location**: `dashboard-client.tsx` (ExecutiveStats component, called from main)
- **Variants**:
  - **GLOBAL view**: Identity "email · SUPER_ADMIN · GLOBAL" | Global AUM, Net Treasury Yield, Active Campuses, Total Assets (scope) | **Command Center**: $ Total Yield Disbursed, Active Assets X/Y
  - **TENANT view**: Identity "email · Role · Org name" | Campus Liquidity, Yield Earned, Active Fleet, Claimed, Redemptions | **Command Center**: $ Total Yield Disbursed, Active Assets X/Y
- **Live data**: % change indicators (green/red) and "Live" badge + pulse on Command Center numbers; values will be wired to BENJI API for real-time yield
- **Note**: Always visible regardless of active tab; Command Center was moved from Map tab into this banner so it is consistent across all pages

### 4. **Main Content Area** (or "Content Pane", "Tab Content")
- **Location**: Below Executive Stats Banner
- **Purpose**: Tabbed content that switches based on active tab
- **Current styling**: `main` tag with `p-0`
- **Code location**: `dashboard-client.tsx` lines 484-539
- **Tabs**:
  - **Map Tab**: Full-screen map view (`MapView` component)
  - **Fleet Tab**: Fleet management table and controls (`FleetTab` component)
  - **Campaigns Tab**: Campaign creation and list (`CampaignsTab` component)
  - **Settings Tab**: Role permissions, Redemption success message, token creation (SUPER_ADMIN only) (`SettingsTab` component)

## Sub-Components (within tabs)

### Fleet Tab Structure
- **Control Bar**: Top toolbar with campaign/org selectors and action buttons
- **Fleet Table**: Main data table showing tokens/assets
- **Empty State**: Centered icon + message when no tokens

### Claim flow
- **Claim success page:** After a successful claim, shows &quot;ACCESS GRANTED&quot;, &quot;Asset Secured: $25.00&quot;, &quot;Payout will be sent to your Venmo.&quot; Below that, an optional **Redemption success message** (note + optional website link) can be configured in **Settings → Redemption success message** (max 200 characters for note). If empty, nothing is shown.

### Campaigns Tab Structure
- **Create Campaign Section**: Form for new campaigns (left column in grid)
- **Campaigns list**: List of campaigns with status, search, pagination (right column)
- **Create campaign button**: Footer action to create a draft campaign

## Quick Reference

When requesting changes, use these terms:
- **"View Mode Banner"** = Top banner with GLOBAL/TENANT toggle
- **"Nav Bar"** or **"Header"** = Sticky navigation with tabs
- **"Stats Banner"** = Metrics row (Global AUM, Campus Liquidity, etc.)
- **"Content Area"** = Main tabbed content below stats
- **"Control Bar"** = Toolbar within Fleet tab
- **"Fleet Table"** = Data table in Fleet tab
- **"Create Campaign Section"** = Left side of Campaigns tab
- **"Campaigns list"** = Right side of Campaigns tab (campaigns with status, search, pagination)

## Styling Patterns

- **Borders**: `border-white/10` for subtle separation
- **Backgrounds**: `bg-slate-900/50` for cards, `bg-muted` for nav
- **Spacing**: 8px rhythm (gap-2, gap-4, gap-6, gap-8)
- **Typography**: `font-mono` for IDs, coordinates, financial values; `font-sans` for UI
- **Elevation**: Cards use `border border-white/10 bg-slate-900/50` for depth
