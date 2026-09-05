# Ward Explorer

An interactive map of the 23 electoral wards of Stellenbosch Municipality.

**Live site: https://javaftw.github.io/wards-map/**

It answers the three questions residents ask most often — *Which ward am I in? Who
is my councillor and how do I reach them? Where do I vote?* — in one place, from
the same public data the authorities publish.

> **This site is unofficial.** It is a citizen's effort, not endorsed by the
> Municipal Demarcation Board, the Electoral Commission (IEC), Stellenbosch
> Municipality, or any other data provider. For anything official, confirm with
> the relevant authority.

## What it does

**All-wards view** (the home page) — every ward on one map, with the councillor,
population and voting stations on hover, and **Ward Insights**: a choropleth that
shades the wards by any census metric, in your choice of colour scheme and either
continuous or quantile classification.

**Single-ward view** (`?ward=11`) — one ward in detail: its voting districts and
voting stations, the councillor's name, phone and email, and a demographics panel
of census pie charts.

**Find my ward** — search an address or use your device's location, and the map
tells you which ward the point falls in and takes you there.

**Where do I vote?** — the same lookup names the voting district the point falls
inside and the station serving it, with the address, the distance and a directions
link. The station is chosen by which district actually contains the point, not by
which one is closest: near a boundary those differ, and the closest station often
serves someone else's district.

**Download PDF** — an A4-landscape sheet composed for the ward (not a screenshot):
branded header, demographics column, and the map. Optionally with every voting
station labelled by name and address.

Also: OpenStreetMap or satellite base layers, zoom-to-area, and layer toggles.

## Data sources

| Layer | Source |
| --- | --- |
| Ward boundaries | Municipal Demarcation Board — official 2026 hosted Feature Service |
| Voting districts and stations | Electoral Commission (IEC) elections API |
| Census demographics, ward areas | Stellenbosch Municipality (bundled as JSON) |
| Councillor contact details | Stellenbosch Municipality (bundled as JSON) |
| Address search | Nominatim (OpenStreetMap) |

Boundaries and voting data are fetched live, so the map reflects those services as
they stand. Note that the IEC is still actively updating its voting district data,
so not every district shown is necessarily current.

## Privacy

No accounts, no cookies, no analytics, no tracking of any kind. The only thing
stored in your browser is a flag recording that you dismissed the disclaimer, and
it lasts for the session. An address you search for, or your position if you
choose "Use my location", is sent only to the mapping services that answer the
question, and is never stored by this site.

## Running it locally

There is nothing to build — no framework, no bundler, no package manager. Serve
the directory over HTTP (`file://` breaks `fetch()` of the JSON and CORS to the
map APIs):

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

## How it is put together

| Path | What it is |
| --- | --- |
| `index.html` | The only page. `?ward=N` renders one ward, `?ward=all` or no parameter renders them all |
| `js/ward-map.js` | The whole application, one IIFE, organised into numbered sections |
| `js/piegraph.js` | Standalone dependency-free SVG pie/donut generator |
| `js/*.json` | Councillors, demographics and ward areas, keyed by ward ID |
| `css/style.css` | All styling |
| `CLAUDE.md` | Architecture notes and the load-bearing constraints behind some non-obvious choices |
| `FEATURES.txt` | The case for the map, written for the municipality |

Leaflet, html2canvas and jsPDF load from CDNs; there are no local dependencies.

## Questions, corrections, ideas

Spotted a boundary that looks wrong, a councillor's details out of date, or
something the map should do? Please
[open an issue](https://github.com/javaftw/wards-map/issues) — corrections to the
bundled data are especially welcome.

## Licence

Copyright © 2026 Hennie Kotze.

Released under the **GNU Affero General Public License v3.0** — see
[LICENSE](LICENSE). You are free to use, study, modify and share it; if you run a
modified version as a public service, the AGPL requires that you make your source
available too.
