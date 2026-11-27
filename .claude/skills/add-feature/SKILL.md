---
name: add-feature
description: Checklist for adding a screen, entity, capability, event or AI tool to a module (or a new module) so manifests, web routes, migrations and Help guides stay consistent.
---

# Add a feature to the platform

Copy the shape of a small existing module (`apps/api/src/modules/whiteboard` or `time`) rather than
inventing one. Read the module's brief in `docs/` and `docs/decision-log.md` entries about it first;
do not reopen decided items.

## Backend (`apps/api/src/modules/<m>/`)

1. **Schema** in `<m>.schema.ts` (own Postgres schema only; money = integer cents; no reads of other
   modules' tables). Generate with `pnpm --filter @platform/api db:generate`. If a table is dropped and
   another created, split into two migrations (drizzle prompts interactively). Hand-written SQL must pass
   `pnpm migrations`. Never edit applied migrations or `drizzle/meta/_journal.json`.
2. **Service** (`<m>.service.ts`) is the module's published API; other modules may import only `*.service.ts`
   and `*.module.ts`. Writes that create an entity register it in the core registry in the **same transaction**.
3. **Controller** enforces a capability declared in the manifest. Reads/writes under the caller's `Actor`.
4. **Manifest** (`<m>.manifest.ts`): entities (`urlPattern` must be a real web route), events (ids and scalars
   only), capabilities (`<module>.<area>.<action>`, `adminOnly` if sensitive), navigation, widgets,
   `portalExposure` (empty unless deliberately exposing named fields), `aiTools` with the lowest honest
   `riskClass`. Tools that reach a client are `restricted`. Never let client-written text feed an AI tool.
5. **Module wiring**: register in `app.module.ts`; the module registers its manifest and tools in
   `onModuleInit` through `ManifestRegistry` and `AiToolRegistry` (see `whiteboard.module.ts`).
   A new module's manifest also goes in the list in `modules/help/help.content.spec.ts`.
6. **Specs** beside the code. If the feature touches the portal, assert on serialized response bodies that
   nothing internal escapes (see `portal-isolation.spec.ts`).

## Web (`apps/web/src/modules/<m>/`)

7. Export a `WebModule` from `index.ts` (routes, `chatWidgets` keyed by entity type, `widgets` keyed by the
   manifest's `widgets[].component` string) and add it to `apps/web/src/modules/index.ts`.
8. Cross-module "next step" buttons gate on `useInstalled()` from `shell/useNav.tsx`.
9. Phone: one breakpoint (`40rem`, `src/phone.css` + `PHONE` in `shell/useMediaQuery.ts`); touch rules key on
   `(hover: none)`/`(pointer: coarse)`. Refine the current look; don't restyle.

## Help (required)

10. Add or update a guide in `apps/api/src/modules/help/content/<m>/<task>.md` (front matter: title, summary,
    module, `paths` covering every new route/entity URL, capability, keywords, `updated`). Describe what the
    screen actually does, UI labels in bold, who may do it, what is irreversible. See `docs/help-authoring.md`.

## Then

11. Run the `verify` skill (lint, typecheck, build, tests, boundaries, routes, widgets, migrations, bundle).
12. If the change is a real decision (new boundary, new data flow, anything a future reader would otherwise
    undo), add a dated entry to `docs/decision-log.md`: what, why, what was rejected, when to revisit.
13. Do not commit or deploy unless asked.
