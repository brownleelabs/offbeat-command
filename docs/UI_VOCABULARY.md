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
- **Purpose**: Persistent financial/operational metrics
- **Current styling**: `border-b border-white/10 bg-background/95 px-6 py-6` with grid of 3 stat cards
- **Code location**: `dashboard-client.tsx` lines 485-489 (render), 576-645 (component)
- **Variants**:
  - **GLOBAL view**: Global AUM, Net Treasury Yield, Active Campuses
  - **TENANT view**: Campus Liquidity, Yield Earned, Active Fleet
- **Note**: Always visible regardless of active tab

### 4. **Main Content Area** (or "Content Pane", "Tab Content")
- **Location**: Below Executive Stats Banner
- **Purpose**: Tabbed content that switches based on active tab
- **Current styling**: `main` tag with `p-0`
- **Code location**: `dashboard-client.tsx` lines 484-539
- **Tabs**:
  - **Map Tab**: Full-screen map view (`MapView` component)
  - **Fleet Tab**: Fleet management table and controls (`FleetTab` component)
  - **Campaigns Tab**: Campaign creation and list (`CampaignsTab` component)
  - **Settings Tab**: Role permissions (SUPER_ADMIN only) (`SettingsTab` component)

## Sub-Components (within tabs)

### Fleet Tab Structure
- **Control Bar**: Top toolbar with campaign/org selectors and action buttons
- **Fleet Table**: Main data table showing tokens/assets
- **Empty State**: Centered icon + message when no tokens

### Campaigns Tab Structure
- **Create Campaign Section**: Form for new campaigns (left column in grid)
- **Active Surveys Section**: List of existing campaigns (right column in grid)
- **Launch Campaign Button**: Footer action button with divider above

## Quick Reference

When requesting changes, use these terms:
- **"View Mode Banner"** = Top banner with GLOBAL/TENANT toggle
- **"Nav Bar"** or **"Header"** = Sticky navigation with tabs
- **"Stats Banner"** = Metrics row (Global AUM, Campus Liquidity, etc.)
- **"Content Area"** = Main tabbed content below stats
- **"Control Bar"** = Toolbar within Fleet tab
- **"Fleet Table"** = Data table in Fleet tab
- **"Create Campaign Section"** = Left side of Campaigns tab
- **"Active Surveys Section"** = Right side of Campaigns tab

## Styling Patterns

- **Borders**: `border-white/10` for subtle separation
- **Backgrounds**: `bg-slate-900/50` for cards, `bg-muted` for nav
- **Spacing**: 8px rhythm (gap-2, gap-4, gap-6, gap-8)
- **Typography**: `font-mono` for IDs, coordinates, financial values; `font-sans` for UI
- **Elevation**: Cards use `border border-white/10 bg-slate-900/50` for depth
