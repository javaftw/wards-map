# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page Leaflet map of the electoral wards of Stellenbosch Municipality. It is a **static site with no build step, no framework, no package manager, and no tests** — just `index.html`, one CSS file, one JS file, and JSON data. All third-party libraries (Leaflet, html2canvas, jsPDF) load from CDNs via `<script>` tags in `index.html`.

## Running / developing

There is nothing to compile. Serve the directory over HTTP (not `file://`, which breaks `fetch()` of the JSON and CORS to the map APIs):

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

- `index.html` is the **only** page — it renders both modes based on the `ward` query param:
  - `?ward=N` (N = 1..23) → single-ward view
  - `?ward=all`, `?ward=`, or no param → all-wards overview (treated as the homepage)
  - Out-of-range or non-numeric → error box
- `iec-api-test.html` is a standalone manual harness for probing the live IEC GIS API; it is not part of the app.

## Architecture

Everything is in `js/ward-map.js` — a single IIFE, organized into the numbered sections its header comments describe (config → URL parsing → REST querying → reference data → map/legend/controls → styles → labels → hover → UI → mode orchestration). `CONFIG` at the top is the single source of truth for API URLs, the ward-number scheme, colors, and icon paths.

**Two data sources, fetched in parallel, with different failure semantics:**
1. **Ward boundaries (primary)** — the Municipal Demarcation Board's official 2026 hosted Feature Service (`CONFIG.wardLayerUrl`, item `CONFIG.wardServiceItemId`), queried as GeoJSON. It is national, so every query filters on `CAT_B='WC024'` (`CONFIG.municipalityCode`) and addresses wards by the integer `WardNo` field — never by a constructed `WardID`. If this fails, the whole map fails with an error box (`map.remove()`).
2. **Voting districts + stations (secondary)** — IEC elections API. Failure is **non-fatal**: the ward map still renders, and a notice banner (`#iec-notice`) explains what's missing. The all-wards mode fetches all 23 wards' VDs with `Promise.allSettled` and tolerates partial failure.
3. **Reference data** — `js/councillors.json`, `js/demographics.json`. Also non-fatal; the app just shows less in the legend/tooltips/demographics panel. `demographics.json` is keyed by ward number and carries `population` plus census breakdowns per ward; `fetchReferenceData` re-keys it on `wardid`, exposing population as `{ total }` (`populationByWardNo`) and the full entry (`demographicsByWardNo`).

**Ward numbering:** boundaries are *fetched* by `WardNo` (1–23), but the `WardID` string (`CONFIG.wardNoPrefix` `"10204"` + zero-padded number, e.g. ward 11 → `"10204011"`) is still the join key for `councillors.json` / `demographics.json` / `ward-areas.json` and the ID the IEC API takes. The boundary service supplies `WardID` per feature; `buildWardNo()` builds it where no feature is in hand (single-ward mode, IEC calls).

**Custom controls replace Leaflet's defaults.** The top-left "Tools" box (`createToolsControl`) is a hand-rolled replacement for both the zoom control and the layers control — layer visibility is toggled via direct `map.addLayer()`/`removeLayer()`, not Leaflet layer-control events. The bottom-right legend (`createLegendControl`) is content-swapped per mode. The single-ward-only top-right demographics panel (`createDemographicsControl`) renders census pie charts and, like Tools, is a collapsible card.

**`js/piegraph.js`** is a standalone dependency-free SVG pie/donut generator (`window.PieGraph`, loaded before `ward-map.js`). It knows nothing about demographics — callers pass `[{label, value}]` slices; it normalizes, drops null/≤0 values, and returns an `<svg>`. `PieGraph.colorAt(i)` exposes the palette so a caller's own legend can match slice colors by index.

### Non-obvious constraints (don't "fix" these without understanding why)

These are load-bearing and heavily commented at their definitions. Read the comment before changing:

- **`preferCanvas: true`** on the map — required so html2canvas can capture polygons for the PDF export (Leaflet's SVG renderer's viewBox trick corrupts the capture).
- **Voting stations are `L.marker` div-icons, not canvas `circleMarker`s** — because with `preferCanvas`, all paths in a pane share one full-map canvas that would swallow clicks/hovers on everything beneath it. Stations live in a dedicated higher-z `stationsPane`.
- **`zoomSnap: 0`** — enables exact fractional `fitBounds` (initial view, Recenter, Zoom-to-area) instead of snapping to a looser integer zoom.
- **Map container must be un-hidden before `L.map()` is created** (`showMapArea(true)` precedes `createMap()`), or Leaflet caches a 0×0 size.
- **PDF export** (`exportWardPdf`) is a *composed* A4-landscape page, not a screenshot of the live map. It captures the map alone (overlays hidden, `captureMapCanvas`), then builds an offscreen DOM (`buildPdfPageElement`) laid out like the wireframe — navy/maroon header band, maroon demographics column reusing `buildDemographicSection`, map filling the right — and rasterises that. Per-mode content comes from `toolsControl.setPdfContext(fn)`. Can still fail on Google Satellite (raw tiles aren't CORS-friendly); caught and surfaced, not silent.
- **Base-layer switching** recolors polygon outlines (white on satellite, brand color otherwise) via the `outline` controller, which every rendered ward/VD layer registers with.

## Style conventions

Match the existing code: ES5-flavored (`var`-free but `function` expressions, `.forEach`, no arrow-function/class overhaul), `"use strict"`, DOM built imperatively via `createElement`/`textContent` (no `innerHTML` with data). Keep new configuration in `CONFIG` rather than inlining URLs/colors.
