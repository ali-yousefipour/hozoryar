---
name: "حضوریار"
description: "Implemented Persian RTL attendance website and administration interface"
colors: {"primary": "#6d28d9", "workflow-purple": "#4c1d95", "site-bg": "#faf9fc", "site-text": "#271e35", "site-muted": "#625b70", "site-line": "#ded9e6", "site-paper": "#fff", "site-dark-bg": "#14121b", "site-dark-text": "#f2eef8", "site-dark-muted": "#bcb4cb", "site-dark-line": "#3e354e", "site-dark-paper": "#211b2d", "site-dark-accent": "#c4b5fd", "panel-light-bg": "#f6f7fb", "panel-light-text": "#282238", "panel-light-border": "#dddfe9", "panel-light-muted": "#686579", "panel-dark-bg": "#101119", "panel-dark-surface": "#191a23", "panel-dark-text": "#f0edf7", "panel-dark-border": "#313240", "panel-dark-muted": "#aaa9ba", "panel-dark-action": "#7c3aed", "success": "#15803D", "danger": "#B91C1C"}
typography: {"display": {"fontFamily": "Vazirmatn, Tahoma, sans-serif", "fontSize": "clamp(36px,4.2vw,62px)", "fontWeight": 800, "lineHeight": 1.55, "letterSpacing": "-.025em"}, "headline": {"fontFamily": "Vazirmatn, Tahoma, sans-serif", "fontSize": "28px", "fontWeight": 700, "lineHeight": 1.7}, "body": {"fontFamily": "Vazirmatn, Tahoma, sans-serif", "lineHeight": 1.9}, "site-label": {"fontFamily": "Vazirmatn, Tahoma, sans-serif", "fontSize": "14px", "fontWeight": 600}, "panel-body": {"fontFamily": "Vazirmatn, Tahoma, sans-serif", "fontSize": "16px", "lineHeight": 1.7}, "panel-title": {"fontFamily": "Vazirmatn, Tahoma, sans-serif", "fontSize": "22px"}, "panel-metric": {"fontFamily": "Vazirmatn, Tahoma, sans-serif", "fontSize": "32px"}}
rounded: {"control": "8px", "panel-card": "12px", "site-region": "16px", "pill": "20px"}
spacing: {"hz-space-1": "4px", "hz-space-2": "8px", "hz-space-3": "12px", "hz-space-4": "16px", "hz-space-6": "24px", "hz-space-8": "32px"}
components: {"button-primary": {"backgroundColor": "{colors.primary}", "textColor": "{colors.site-paper}", "rounded": "{rounded.control}", "padding": "11px 22px", "typography": "{typography.site-label}"}, "button-primary-hover": {"backgroundColor": "#5420a8"}, "panel-button-primary": {"backgroundColor": "{colors.primary}", "textColor": "{colors.site-paper}", "rounded": "{rounded.control}", "padding": "12px 20px"}, "panel-card": {"backgroundColor": "{colors.site-paper}", "textColor": "{colors.panel-light-text}", "rounded": "{rounded.panel-card}", "padding": "22px"}, "panel-input": {"backgroundColor": "{colors.site-paper}", "textColor": "{colors.panel-light-text}", "rounded": "{rounded.control}", "padding": "11px 14px"}}
---

# Design System: حضوریار

## Overview

**Creative North Star: "Operational clarity"**

This is a source-first record of the implemented Persian RTL interface, preserving the purple Hozoryar identity. “Operational clarity” is a descriptive shorthand for the built direction, not a newly approved metaphor or a fabricated workshop result. The public website is editorial and spacious; the administration panel is denser, with light operational neutrals and explicit light/dark/system choice.

PRODUCT.md and branding/BRAND.md remain product and identity authorities. This document records implementation, including differences from older branding recommendations; it does not replace those sources or the generated legacy design-system MASTER. Source precedence for the panel is style.css → nav.css → panel.css → theme.css → product.css. Website home.css imports product.css, then defines its own site tokens.

**Key Characteristics:**
- Persian RTL reading and navigation with self-hosted web Vazirmatn.
- Purple identity, restrained operational surfaces, explicit theme choice.
- Separate website and panel palettes; local overrides remain contextual.

## Colors

### Primary
The primary token preserves the approved brand. The public website uses workflow-purple for its flat explanatory region, with white content. Website CTA hover is its component variant. The panel uses primary for light-mode actions and panel-dark-action for dark-mode primary buttons. Semantic success and danger remain operational signals, not decorative accents.

### Neutral
The site-* tokens belong to home.css; site-dark-* replace those roles in dark mode. The panel-light-* and panel-dark-* sets belong to theme.css and panel.css respectively. White is the panel light surface. The site's dark accent is a pale purple for links and focus; the CTA remains saturated purple. Do not replace all panel colors with the website palette.

**The Surface Context Rule.** Resolve colors against the actual website or panel cascade and active theme before extending a screen.

## Typography

The web stack is Vazirmatn, Tahoma, sans-serif. product.css self-hosts Regular for weights 400–500 and Bold for 600–900 with font-display:swap; requested CSS weights are not evidence of separate font files. Display and headline roles are public-site roles, panel-title and panel-metric are panel roles. Website paragraphs use body leading, with hero copy at 17px and 52ch; narrow hero copy becomes 15px. Site h2 becomes 24px at the narrow breakpoint; hero display becomes 36px. Panel form labels use 13px and requested weight 650. Numeric tables and metrics use tabular-nums.

Native App.js and RequestComposer.js do not declare a fontFamily. Their right-aligned native text and requested weights are source evidence only; do not infer that the web font is loaded on Android.

## Layout

The public site caps header, main and footer at 1280px, uses 36px horizontal gutters, a 1.25fr/1fr hero with 64px gap, and a .9fr/1.25fr capabilities grid with 70px gap. At 850px both become single-column; at 520px gutters become 20px and navigation occupies a separate full-width row. The FAQ caps at 920px. Start content has 36px padding, reduced on narrow screens.

The panel uses a 240px sidebar and fluid content, capped at 1600px with 26px/28px main padding. At 1100px the sidebar is 210px, metrics become two columns, lists one column, and setup steps three columns. At 760px the sidebar becomes a toggled fixed menu; setup steps become two columns with the final odd item spanning the row. The 761–900px product override restores sticky full-height sidebar behavior that legacy CSS would otherwise suppress. Table wrappers scroll independently; ordinary tables retain a 450px minimum width. Workplace forms have further local exceptions; do not promote them into global defaults.

The hz-space scale is a shared primitive; implementation also uses contextual gaps such as 18px and 20px. It is not an assertion that every existing measurement follows that scale.

## Elevation & Depth

Public-site surfaces are flat: borders, whitespace and the purple workflow region establish hierarchy. Panel cards and primary actions explicitly remove legacy shadows. Login retains an ambient shadow (0 20px 60px #0003); the open mobile menu uses 0 20px 70px #0009. These are contextual exceptions, not a global lifted-card style. Legacy login gradients remain in source; metric gradients and dotted decoration are overridden by product.css.

**The Flat Operations Rule.** Keep administrative cards flat and use borders and theme surfaces for their hierarchy.

Panel navigation transitions background and color over .18s; toast opacity also uses .18s. Reduced-motion rules suppress transitions. Do not add speculative motion tokens.

## Shapes

Website controls use control rounding; workflow/start regions use site-region rounding. Panel cards and metrics use panel-card rounding after overrides; fields and buttons use control rounding. Badges inherit pill rounding. These actual defaults differ from older token-file/brand recommendations for 16px cards and 12px controls. Preserve that distinction rather than claiming legacy values are reconciled. Native cards use 20px, App controls 12px, and request choices/inputs 8px; these are native-specific observations.

## Components

### Buttons
Website primary links use button-primary and its hover variant, a 46px minimum height and inline alignment. Their focus outline is 3px using the site accent with 5px offset. Panel primary actions use panel-button-primary; dark mode changes their background to panel-dark-action and hover resolves the primary-dark token. Panel ghost controls have transparent fill, an outlined edge, and contextual themed hover. Base web controls are at least 46px high; native actions use 48–50px minimums. Existing compact workplace-map controls are local exceptions, not a new touch-target recommendation.

### Cards / Containers
Panel cards use a one-pixel panel border, 22px padding and no shadow; dashboard list padding becomes 16px on mobile. Metrics use neutral surfaces rather than colored gradient cards; meaning remains in the icon and content. The public workflow region is a single flat purple explanation region, not a stack of ornamental cards.

### Inputs / Fields
Panel fields use an outlined neutral surface, control rounding and 11px/14px padding. Light field stroke is #b9b5c7; dark stroke is #494656. Focus shifts border to #8b5cf6; the inherited keyboard outline is 3px #a78bfa, offset 2px. Error messages remain explicit text. Disabled buttons inherit reduced opacity and a not-allowed cursor; busy buttons use a wait cursor.

### Navigation
Public navigation uses 14px text links and accent hover, with a separate mobile row. The panel uses right-aligned buttons, minimum 48px height for ordinary navigation and 44px for nested groups; active states use themed purple tint, without the earlier inset shadow. Group summaries expose open/closed state. The mobile menu is toggled rather than a horizontally clipped sidebar.

### Chips / Status
Panel badges use 5px/10px padding and 12px text. Generic badges are purple tinted; successful states are green. Keep written status with the color. Do not turn status chips into decorative marketing claims.

## Do's and Don'ts

### Do:
- Do preserve the Persian product name, RTL layout and approved purple identity.
- Do choose tokens from the target surface and active theme, reading the complete stylesheet cascade.
- Do keep visible keyboard focus, meaningful status colors and independent table scrolling.
- Do describe real capabilities and state limitations plainly.

### Don't:
- Don't invent customer counts, prices, operational statistics or release approval.
- Don't treat legacy gradients, eyebrow styles or conflicting radius variables as new defaults.
- Don't claim Android visual approval or self-hosted native Vazirmatn from web font declarations.
- Don't replace or alter the approved original logo files to conceal their decoding defect.


Evidence boundary: docs/REDESIGN_REVIEW.md resolves the requested three-eyebrow removal and says ship within that fix-list scope. It is not whole-product release approval. Web captures in .impeccable/review cover site and selected dashboard/traffic widths/themes; unchanged lower-site section captures predate that fix. Android is source-only, without device visual approval. Original corrupt logo assets remain preserved, with visible wordmark fallback; a healthy approved asset is still needed for APK icon/splash. Legacy CSS drift and native font/asset gaps are recorded, not repaired or legitimized here.
