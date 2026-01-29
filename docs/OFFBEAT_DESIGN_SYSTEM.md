# Offbeat Options: The "Command Console" Design System v1.0

## 1. Core Philosophy: "Kinetic Trust"
The UI does not just display data; it demonstrates control.
- **Dark Mode Default:** We operate in the "Cockpit."
- **Monospace Data:** If it is a coordinate, an ID, or money, it is `font-mono`.
- **Sans-Serif UI:** Instructions and labels are `font-sans` (Inter).

## 2. The Color Dictionary (Semantic Stability)
Do not use random colors. Use meanings.

| Meaning | Tailwind Class | Usage |
| :--- | :--- | :--- |
| **Operational (Primary)** | `text-blue-400` / `bg-blue-500/10` | Standard actions, Campaign selection. |
| **Financial (Success)** | `text-emerald-400` / `bg-emerald-500/10` | Yield, Money, "Active" status. |
| **Administrative (Warning)** | `text-amber-400` / `bg-amber-500/10` | Org transfers, System settings. |
| **Critical (Destructive)** | `text-red-400` / `bg-red-500/10` | Deletion, Errors, "Offline" status. |
| **Muted (Context)** | `text-slate-500` | Labels, Timeframes, Secondary info. |

## 3. The "Z-Pattern" Layout Strategy
1.  **Top Left (The Anchor):** Page Title & "Live" Status.
2.  **Top Right (The Context):** Global Stats & User Profile.
3.  **Center (The Work):** The Data Grid / Map.
4.  **Bottom Right (The Action):** Primary "Commit" Buttons.

## 4. Component Rules
- **Cards:** `bg-slate-900/50` with `border border-white/5`.
- **Inputs:** Deep wells. `bg-black/20` with `focus:ring-2 ring-blue-500/20`.
- **Shadows:** We use "Glows" instead of shadows. `shadow-lg shadow-blue-500/10`.