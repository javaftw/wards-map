/* -----------------------------------------------------------
   Stellenbosch Ward Map
   Single reusable map page. The `ward` URL query parameter picks
   either a single ward (?ward=N) or every ward at once (?ward=all).
   ----------------------------------------------------------- */

(function () {
  "use strict";

  /* =============================================================
     1. CONFIGURATION
     ============================================================= */
  const CONFIG = {
    // Ward boundaries: the Municipal Demarcation Board's official 2026
    // hosted Feature Service. Single source of truth for the endpoint —
    // change it here if the MDB republishes the dataset. `wardServiceItemId`
    // is the stable ArcGIS item identifier for that hosted service; it is
    // documentation only, nothing at runtime queries by item ID.
    wardLayerUrl:
      "https://services7.arcgis.com/oeoyTUJC8HEeYsRB/ArcGIS/rest/services/Wards2026_02April2026/FeatureServer/0",
    wardServiceItemId: "c253949831354e40ac37154de58922b5",

    // The service holds every ward in the country; CAT_B selects the
    // municipality. Wards are then addressed by the plain integer WardNo,
    // never by a constructed WardID.
    municipalityCode: "WC024",

    // WardID ("10204011") is not used to fetch — the service supplies it
    // per feature — but it is still the join key for councillors.json,
    // demographics.json and ward-areas.json, and the ID the IEC API wants.
    wardNoPrefix: "10204",
    wardNoDigits: 3,

    minWard: 1,
    maxWard: 23,

    allWardsParam: "all",

    municipalityName: "Stellenbosch",

    initialView: {
      lat: -33.9346,
      lng: 18.8601,
      zoom: 12,
    },

    fitBoundsPadding: [30, 30],

    osmTileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    osmAttribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    osmMaxZoom: 19,

    // NOTE: this is the commonly-used raw Google tile endpoint, not
    // an officially sanctioned way to embed Google satellite imagery
    // outside their own JS API/terms. Works, but worth knowing.
    googleSatTileUrl: "https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    googleSatSubdomains: ["mt0", "mt1", "mt2", "mt3"],
    googleSatAttribution: "Imagery &copy; Google",
    googleSatMaxZoom: 20,

    iec: {
      baseUrl: "https://api.elections.org.za/IECGIS/api/",
    },

    dataUrls: {
      councillors: "js/councillors.json",
      demographics: "js/demographics.json",
      areas: "js/ward-areas.json",
    },

    icons: {
      zoomIn: "img/zoom_in.svg",
      zoomOut: "img/zoom_out.svg",
      zoomArea: "img/zoom_area.svg",
      recenter: "img/recenter.svg",
      downloadPdf: "img/generate_pdf.svg",
      allWards: "img/all_wards.svg",
    },

    logos: {
      header: "img/header_stelmuni_logo.svg",
    },

    styles: {
      ward: { color: "#002157" },
      vd: { color: "#971a32" },
      station: { color: "#971a32" },
      weight: 3,
      fillOpacity: 0.25,
      hoverFillOpacity: 0.55,
      // On the single-ward map the VD polygons tile the ward exactly,
      // so a VD fill would just sit on top of the ward fill and every
      // VD outline would coincide with a neighbour's (or with the
      // ward boundary). VDs are therefore drawn as outlines only —
      // the fill appears on hover, which is what makes the hovered
      // district stand out. See renderSingleWard for the matching
      // two-layer ward treatment.
      vdFillOpacity: 0,
      vdHoverFillOpacity: 0.4,
      // Weight of the ward boundary on the single-ward map, where it
      // is drawn *over* the VD outlines it coincides with. It has to
      // be heavier than `weight` so it reads as the enclosing
      // boundary rather than as one more VD edge.
      wardOutlineWeight: 6,
    },
  };

  const ERROR_MESSAGES = {
    invalid: "Invalid ward number.",
    range: "Invalid ward number.",
    network:
      "Unable to load the ward boundary. Please check your internet connection and try again.",
    empty: "The requested ward could not be found.",
    badResponse: "Unable to load the ward boundary. Please check your internet connection and try again.",
  };

  /* =============================================================
     2. URL PARSING & VALIDATION
     ============================================================= */

  function getWardParamFromLocation() {
    const params = new URLSearchParams(window.location.search);
    return params.get("ward");
  }

  // Returns one of:
  //   { valid: true, mode: "single", wardNumber }
  //   { valid: true, mode: "all" }
  //   { valid: false, reason }
  //
  // No ward param at all (the site root, now that there's no
  // separate landing page) is treated the same as ?ward=all rather
  // than as an error — it's the closest equivalent to a homepage.
  function validateWardParam(raw) {
    if (raw === null || raw === "" || raw === CONFIG.allWardsParam) {
      return { valid: true, mode: "all" };
    }
    if (!/^\d+$/.test(raw)) {
      return { valid: false, reason: "invalid" };
    }
    const wardNumber = parseInt(raw, 10);
    if (wardNumber < CONFIG.minWard || wardNumber > CONFIG.maxWard) {
      return { valid: false, reason: "range" };
    }
    return { valid: true, mode: "single", wardNumber: wardNumber };
  }

  /* =============================================================
     3. REST QUERYING (MDB + IEC)
     ============================================================= */

  function buildWardNo(wardNumber) {
    const padded = String(wardNumber).padStart(CONFIG.wardNoDigits, "0");
    return CONFIG.wardNoPrefix + padded;
  }

  async function queryWardLayer(whereClause) {
    const url = new URL(CONFIG.wardLayerUrl + "/query");
    url.searchParams.set("where", whereClause);
    url.searchParams.set("outFields", "*");
    url.searchParams.set("returnGeometry", "true");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("f", "geojson");
    const requestUrl = url.toString();

    let response;
    try {
      response = await fetch(requestUrl);
    } catch (networkErr) {
      throw new Error("network");
    }

    if (!response.ok) {
      throw new Error("network");
    }

    let payload;
    try {
      payload = await response.json();
    } catch (parseErr) {
      throw new Error("badResponse");
    }

    if (payload && payload.error) {
      throw new Error("badResponse");
    }

    if (!payload || !Array.isArray(payload.features) || payload.features.length === 0) {
      throw new Error("empty");
    }

    return payload;
  }

  function municipalityWhere() {
    return "CAT_B='" + CONFIG.municipalityCode + "'";
  }

  function fetchWardGeoJSON(wardNumber) {
    // WardNo is an integer field, so it is compared unquoted.
    return queryWardLayer(municipalityWhere() + " AND WardNo=" + Number(wardNumber));
  }

  function fetchAllWardsGeoJSON() {
    return queryWardLayer(municipalityWhere());
  }

  function buildVotingDistrictsByWardUrl(wardNumber) {
    const wardId = buildWardNo(wardNumber);
    const url = new URL(CONFIG.iec.baseUrl + "VotingDistrictByWard");
    url.searchParams.set("WardID", wardId);
    url.searchParams.set("returnGeom", "true");
    return url.toString();
  }

  async function fetchVotingDistricts(wardNumber) {
    const requestUrl = buildVotingDistrictsByWardUrl(wardNumber);

    let response;
    try {
      response = await fetch(requestUrl);
    } catch (networkErr) {
      throw new Error("iecNetwork");
    }

    if (!response.ok) {
      throw new Error("iecNetwork");
    }

    let payload;
    try {
      payload = await response.json();
    } catch (parseErr) {
      throw new Error("iecBadResponse");
    }

    if (!payload || payload.Status !== "OK") {
      throw new Error("iecBadResponse");
    }

    return Array.isArray(payload.VotingDistrictsDetail)
      ? payload.VotingDistrictsDetail
      : [];
  }

  async function fetchAllVotingDistricts() {
    const wardNumbers = [];
    for (let n = CONFIG.minWard; n <= CONFIG.maxWard; n++) {
      wardNumbers.push(n);
    }

    const results = await Promise.allSettled(wardNumbers.map(fetchVotingDistricts));

    const combined = [];
    let failureCount = 0;
    results.forEach(function (result) {
      if (result.status === "fulfilled") {
        combined.push.apply(combined, result.value);
      } else {
        failureCount += 1;
      }
    });

    return { vdList: combined, failureCount: failureCount, totalWards: wardNumbers.length };
  }

  /* =============================================================
     4. REFERENCE DATA (councillors.json / population.json)
     Non-fatal if unavailable — the app degrades to showing less
     info in the legend/hover tooltips, never blocks the map.
     ============================================================= */

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to load " + url + " (HTTP " + response.status + ")");
    }
    return response.json();
  }

  async function fetchReferenceData() {
    const councillorsPayload = await fetchJson(CONFIG.dataUrls.councillors).catch(function (err) {
      console.warn("Could not load councillors.json:", err);
      return { councillors: [] };
    });
    const demographicsPayload = await fetchJson(CONFIG.dataUrls.demographics).catch(function (err) {
      console.warn("Could not load demographics.json:", err);
      return { wards: {} };
    });
    const areasPayload = await fetchJson(CONFIG.dataUrls.areas).catch(function (err) {
      console.warn("Could not load ward-areas.json:", err);
      return { areas: [] };
    });

    const councillorsByWardNo = {};
    (councillorsPayload.councillors || []).forEach(function (c) {
      councillorsByWardNo[String(c.wardid)] = c;
    });

    // Precomputed ward areas (km²), keyed on wardid to match everything
    // else. See js/ward-areas.json (generated once from the boundary
    // geometry). Population density is derived from this at render time.
    const areaByWardNo = {};
    (areasPayload.areas || []).forEach(function (a) {
      if (a && a.wardid != null && typeof a.area_km2 === "number") {
        areaByWardNo[String(a.wardid)] = a.area_km2;
      }
    });

    // demographics.json is keyed by ward number ("1".."23"); each entry
    // carries its full wardid, a `population` count, and a `demographics`
    // block. Re-key everything on wardid: population is exposed as
    // { total } so downstream legend/hover code (which reads `.total`)
    // is unchanged, and the full entry is exposed for the single-ward
    // demographics panel.
    const populationByWardNo = {};
    const demographicsByWardNo = {};
    const demoWards = (demographicsPayload && demographicsPayload.wards) || {};
    Object.keys(demoWards).forEach(function (key) {
      const entry = demoWards[key];
      if (entry && entry.wardid != null) {
        demographicsByWardNo[String(entry.wardid)] = entry;
        if (typeof entry.population === "number") {
          populationByWardNo[String(entry.wardid)] = { total: entry.population };
        }
      }
    });

    return {
      councillorsByWardNo: councillorsByWardNo,
      populationByWardNo: populationByWardNo,
      demographicsByWardNo: demographicsByWardNo,
      areaByWardNo: areaByWardNo,
    };
  }

  /* =============================================================
     5. MAP / BASE LAYERS / LAYERS CONTROL / LEGEND / HOVER LABEL
     ============================================================= */

  function createBaseLayers() {
    const osm = L.tileLayer(CONFIG.osmTileUrl, {
      attribution: CONFIG.osmAttribution,
      maxZoom: CONFIG.osmMaxZoom,
      // Load tiles CORS-clean (OSM's CDN sends Access-Control-Allow-
      // Origin: *) so the PDF capture can reuse the already-loaded tile
      // images directly, instead of html2canvas re-fetching each one in
      // CORS mode — that re-fetch races the capture and leaves blank
      // blocks, especially on the deployed (non-localhost) site.
      crossOrigin: true,
    });
    const googleSat = L.tileLayer(CONFIG.googleSatTileUrl, {
      subdomains: CONFIG.googleSatSubdomains,
      attribution: CONFIG.googleSatAttribution,
      maxZoom: CONFIG.googleSatMaxZoom,
    });
    return { osm: osm, googleSat: googleSat };
  }

  // Custom bottom-right legend/key control. Content is set later via
  // .update(buildFn) once ward/reference data has loaded.
  function createLegendControl() {
    const control = L.control({ position: "bottomright" });
    let containerEl = null;

    control.onAdd = function () {
      containerEl = L.DomUtil.create("div", "legend-control");
      L.DomEvent.disableClickPropagation(containerEl);
      L.DomEvent.disableScrollPropagation(containerEl);
      return containerEl;
    };

    control.update = function (buildFn) {
      if (!containerEl) {
        return;
      }
      while (containerEl.firstChild) {
        containerEl.removeChild(containerEl.firstChild);
      }
      buildFn(containerEl);
    };

    return control;
  }

  // Compact data-source credits, bottom-left (opposite Leaflet's OSM
  // tile attribution). Boundaries from the MDB, voting data from the
  // IEC, and — on the single-ward map — demographics from Stellenbosch
  // Municipality. Mirrors the PDF's attribution box.
  function createDataAttributionControl(includeDemographics) {
    const control = L.control({ position: "bottomleft" });
    control.onAdd = function () {
      const el = L.DomUtil.create("div", "data-attribution");
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      const lines = [
        "Ward boundaries: Municipal Demarcation Board (MDB)",
        "Voting districts & stations: Electoral Commission (IEC)",
      ];
      if (includeDemographics) {
        lines.push("Demographics: Stellenbosch Municipality");
      }
      lines.forEach(function (text) {
        el.appendChild(document.createElement("div")).textContent = text;
      });
      return el;
    };
    return control;
  }

  function hexWithAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function formatPopulationText(total) {
    if (typeof total !== "number") {
      return null;
    }
    return "Population " + total.toLocaleString();
  }

  // Sums population.total across every ward for the all-wards card's
  // header subtitle. Returns null if no population data loaded.
  function sumPopulation(populationByWardNo) {
    let total = 0;
    let any = false;
    Object.keys(populationByWardNo).forEach(function (wardNo) {
      const p = populationByWardNo[wardNo];
      if (p && typeof p.total === "number") {
        total += p.total;
        any = true;
      }
    });
    return any ? total : null;
  }

  // Navy band: title (ward name / "All wards") + population subtitle.
  function buildLegendHeader(container, title, populationText) {
    const header = document.createElement("div");
    header.className = "legend-header";

    const titleEl = document.createElement("div");
    titleEl.className = "legend-header-title";
    titleEl.textContent = title;
    header.appendChild(titleEl);

    if (populationText) {
      const popEl = document.createElement("div");
      popEl.className = "legend-header-subtitle";
      popEl.textContent = populationText;
      header.appendChild(popEl);
    }

    container.appendChild(header);
  }

  // Maroon band: councillor name + phone (single-ward), or just the
  // municipality name (all-wards). Omitted entirely if there's
  // nothing to show (e.g. councillor data failed to load).
  function buildLegendSubheader(container, lines) {
    if (lines.length === 0) {
      return;
    }
    const subheader = document.createElement("div");
    subheader.className = "legend-subheader";
    lines.forEach(function (line) {
      const el = document.createElement("div");
      el.className = "legend-subheader-line";
      el.textContent = line;
      subheader.appendChild(el);
    });
    container.appendChild(subheader);
  }

  // White band: the style-key swatch rows.
  function buildLegendBody(container, buildRowsFn) {
    const body = document.createElement("div");
    body.className = "legend-body";
    buildRowsFn(body);
    container.appendChild(body);
  }

  function appendLegendRow(container, label, options) {
    const row = document.createElement("div");
    row.className = "legend-row";

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch " + (options.shape === "circle" ? "legend-swatch-circle" : "legend-swatch-square");
    swatch.style.borderColor = options.swatchBorderColor;
    swatch.style.backgroundColor = options.swatchFillColor;
    row.appendChild(swatch);

    const text = document.createElement("span");
    text.textContent = label;
    text.style.color = options.textColor;
    row.appendChild(text);

    container.appendChild(row);
  }

  function appendStyleLegendRows(container, includeVd) {
    appendLegendRow(container, "Ward boundary", {
      shape: "square",
      swatchBorderColor: CONFIG.styles.ward.color,
      swatchFillColor: hexWithAlpha(CONFIG.styles.ward.color, CONFIG.styles.fillOpacity),
      textColor: CONFIG.styles.ward.color,
    });
    if (includeVd) {
      appendLegendRow(container, "Voting District", {
        shape: "square",
        swatchBorderColor: CONFIG.styles.vd.color,
        swatchFillColor: hexWithAlpha(CONFIG.styles.vd.color, CONFIG.styles.vdFillOpacity),
        textColor: CONFIG.styles.vd.color,
      });
    }
    appendLegendRow(container, "Voting Station", {
      shape: "circle",
      swatchBorderColor: "#ffffff",
      swatchFillColor: CONFIG.styles.station.color,
      textColor: CONFIG.styles.station.color,
    });
  }

  function buildAllWardsLegendContent(container, totalPopulation) {
    buildLegendHeader(container, "All wards", formatPopulationText(totalPopulation));
    buildLegendSubheader(container, [CONFIG.municipalityName]);
    buildLegendBody(container, function (body) {
      appendStyleLegendRows(body, false);
    });
  }

  function buildSingleWardLegendContent(container, wardNumber, councillor) {
    // Population is intentionally omitted here — the single-ward
    // demographics panel already shows it (absolute + share).
    buildLegendHeader(container, wardLabel(wardNumber), null);

    const subheaderLines = [];
    if (councillor) {
      subheaderLines.push(councillor.name);
      if (councillor.phone) {
        subheaderLines.push(councillor.phone);
      }
    }
    buildLegendSubheader(container, subheaderLines);

    buildLegendBody(container, function (body) {
      appendStyleLegendRows(body, true);
    });
  }

  /* =============================================================
     5b. DEMOGRAPHICS PANEL (single-ward only)
     Top-right collapsible card, styled to match the Tools box, that
     renders pie charts of the ward's census figures via PieGraph.
     ============================================================= */

  // Maps a demographics.json ward entry to an ordered list of chart
  // sections. Each { label, percentage } list becomes pie slices; the
  // lone age figure becomes a two-slice "15–64 vs rest". Sections with
  // no usable numbers (e.g. ward 23, all null) are dropped entirely.
  // `context` carries the figures the raw demographics block doesn't:
  // { wardNumber, wardPopulation, totalPopulation, wardArea } for the
  // leading area/density and population-share sections.
  function buildDemographicSections(demo, context) {
    const sections = [];
    const ctx = context || {};

    function toSlices(list) {
      return (list || []).map(function (item) {
        return { label: item.label, value: item.percentage };
      });
    }

    function hasData(slices) {
      return slices.some(function (s) {
        return typeof s.value === "number" && isFinite(s.value) && s.value > 0;
      });
    }

    // These figures are percentages of the whole ward, but many fields
    // list only the main categories (e.g. the top income brackets), so
    // they fall short of 100. Append a light-grey "Other" slice for the
    // shortfall so every pie reads as a full 100%. A small threshold
    // avoids a spurious sliver from rounding when the parts already sum
    // to ~100.
    const otherColor =
      (window.PieGraph && PieGraph.DEFAULT_COLORS[PieGraph.DEFAULT_COLORS.length - 1]) || "#c4c4c4";
    function withRemainder(slices) {
      let sum = 0;
      slices.forEach(function (s) {
        const v = Number(s.value);
        if (isFinite(v) && v > 0) {
          sum += v;
        }
      });
      const remainder = 100 - sum;
      if (remainder > 0.5) {
        return slices.concat([
          { label: "Other", value: remainder, color: otherColor, isRemainder: true },
        ]);
      }
      return slices;
    }

    function add(title, slices) {
      if (hasData(slices)) {
        sections.push({ title: title, slices: withRemainder(slices) });
      }
    }

    // Leading section: ward area and derived population density. This is
    // a plain stat block (no pie) — see buildDemographicSection.
    if (typeof ctx.wardArea === "number" && ctx.wardArea > 0) {
      const stats = [{ label: "Area", value: ctx.wardArea.toLocaleString() + " km²" }];
      if (typeof ctx.wardPopulation === "number" && ctx.wardPopulation > 0) {
        const density = Math.round(ctx.wardPopulation / ctx.wardArea);
        stats.push({ label: "Population density", value: density.toLocaleString() + " /km²" });
      }
      sections.push({ title: "Ward Area & Density", stats: stats });
    }

    // This ward's share of the municipality's total population. Values
    // are percentages (share vs remainder) so the pie/legend maths
    // matches the other sections.
    if (
      typeof ctx.wardPopulation === "number" && ctx.wardPopulation > 0 &&
      typeof ctx.totalPopulation === "number" && ctx.totalPopulation > 0
    ) {
      const share = (ctx.wardPopulation / ctx.totalPopulation) * 100;
      sections.push({
        title: "Ward Population (" + ctx.wardPopulation.toLocaleString() + ")",
        slices: [
          { label: wardLabel(ctx.wardNumber), value: share, color: CONFIG.styles.ward.color },
          { label: "Rest of " + CONFIG.municipalityName, value: Math.max(0, 100 - share), color: CONFIG.styles.vd.color },
        ],
      });
    }

    add("Population group", toSlices(demo.population_groups));
    add("Employment", toSlices(demo.employment));

    const age =
      demo.age_demographics &&
      demo.age_demographics.age_15_64 &&
      demo.age_demographics.age_15_64.percentage;
    if (typeof age === "number" && isFinite(age)) {
      add("Age", [
        { label: "15–64", value: age },
        { label: "Under 15 / 65+", value: Math.max(0, 100 - age) },
      ]);
    }

    add("Education (20+)", toSlices(demo.education && demo.education.categories));
    add("Monthly income", toSlices(demo.monthly_income && demo.monthly_income.categories));
    add("Dwelling", toSlices(demo.dwelling));

    return sections;
  }

  // Renders one section. A `stats` section (e.g. area & density) is a
  // simple label/value list; otherwise it's a donut pie beside a
  // colour-keyed legend of label + percentage. Slice colours come from
  // PieGraph's palette by original index, and the legend re-derives the
  // same colours (via PieGraph.colorAt) so the two always agree —
  // skipping the same null/zero slices PieGraph itself drops.
  function buildDemographicSection(section) {
    const wrap = document.createElement("div");
    wrap.className = "demographics-section";

    const title = document.createElement("div");
    title.className = "demographics-section-title";
    title.textContent = section.title;
    wrap.appendChild(title);

    if (section.stats) {
      const stats = document.createElement("div");
      stats.className = "demographics-stats";
      section.stats.forEach(function (stat) {
        const row = document.createElement("div");
        row.className = "demographics-stat-row";
        const label = document.createElement("span");
        label.className = "demographics-stat-label";
        label.textContent = stat.label;
        row.appendChild(label);
        const value = document.createElement("span");
        value.className = "demographics-stat-value";
        value.textContent = stat.value;
        row.appendChild(value);
        stats.appendChild(row);
      });
      wrap.appendChild(stats);
      return wrap;
    }

    const body = document.createElement("div");
    body.className = "demographics-section-body";

    // Always order the remainder ("Other") wedge last — in the pie and
    // the legend alike — regardless of how the slices were assembled.
    // Non-remainder slices keep their relative order (so their palette
    // colours, assigned by index, are unaffected).
    const slices = section.slices
      .filter(function (s) { return !s.isRemainder; })
      .concat(section.slices.filter(function (s) { return s.isRemainder; }));

    const pie = PieGraph.create(slices, {
      size: 84,
      holeRatio: 0.5,
      title: section.title,
    });
    body.appendChild(pie);

    const legend = document.createElement("div");
    legend.className = "demographics-legend";
    slices.forEach(function (slice, i) {
      const value = Number(slice.value);
      if (!isFinite(value) || value <= 0) {
        return; // dropped by PieGraph too — keep colours aligned
      }
      const row = document.createElement("div");
      row.className = "demographics-legend-row";

      const swatch = document.createElement("span");
      swatch.className = "demographics-swatch";
      // Match PieGraph's own choice: explicit per-slice colour (e.g. the
      // black "Other" remainder) wins, otherwise the palette by index.
      swatch.style.backgroundColor = slice.color || PieGraph.colorAt(i);
      row.appendChild(swatch);

      const label = document.createElement("span");
      label.className = "demographics-legend-label";
      label.textContent = slice.label;
      row.appendChild(label);

      const pct = document.createElement("span");
      pct.className = "demographics-legend-pct";
      pct.textContent = (Math.round(value * 10) / 10) + "%";
      row.appendChild(pct);

      legend.appendChild(row);
    });
    body.appendChild(legend);

    wrap.appendChild(body);
    return wrap;
  }

  // Builds the top-right demographics control for a single ward, or
  // returns null when there's nothing to show (no data, or PieGraph
  // wasn't loaded). Mirrors the Tools box: navy header with a rotating
  // collapse chevron over a scrollable white body.
  function createDemographicsControl(wardNumber, demoEntry, totalPopulation, wardArea) {
    if (typeof window.PieGraph === "undefined" || !demoEntry || !demoEntry.demographics) {
      return null;
    }
    const sections = buildDemographicSections(demoEntry.demographics, {
      wardNumber: wardNumber,
      wardPopulation: demoEntry.population,
      totalPopulation: totalPopulation,
      wardArea: wardArea,
    });
    if (sections.length === 0) {
      return null;
    }

    const control = L.control({ position: "topright" });

    control.onAdd = function () {
      // Starts collapsed so it doesn't cover the map on load; the header
      // chevron invites expansion.
      const containerEl = L.DomUtil.create("div", "demographics-control demographics-collapsed");
      L.DomEvent.disableClickPropagation(containerEl);
      L.DomEvent.disableScrollPropagation(containerEl);

      let collapsed = true;

      const header = document.createElement("div");
      header.className = "demographics-header";

      const toggleIcon = document.createElement("span");
      toggleIcon.className = "demographics-header-toggle";
      toggleIcon.setAttribute("aria-hidden", "true");
      header.appendChild(toggleIcon);

      const headerLabel = document.createElement("span");
      headerLabel.className = "demographics-header-label";
      headerLabel.textContent = wardLabel(wardNumber) + " Demographics";
      header.appendChild(headerLabel);

      header.addEventListener("click", function () {
        collapsed = !collapsed;
        containerEl.classList.toggle("demographics-collapsed", collapsed);
      });
      containerEl.appendChild(header);

      const body = document.createElement("div");
      body.className = "demographics-body";

      sections.forEach(function (section) {
        body.appendChild(buildDemographicSection(section));
      });

      containerEl.appendChild(body);
      return containerEl;
    };

    return control;
  }

  // Caps the demographics panel's scrollable body so its bottom stays a
  // fixed gap above the top of the legend, which sits in the opposite
  // (bottom-right) map corner. Their heights are both dynamic and the
  // two live in separate Leaflet control stacks, so this can't be done
  // in CSS — measure on screen and set an inline max-height, keeping it
  // in step on viewport/map resize. The header stays fixed; only the
  // body (pie sections) scrolls when there isn't room for all of it.
  function fitDemographicsPanelToLegend(map, demoControl, legendControl) {
    const container = demoControl.getContainer();
    const legendEl = legendControl.getContainer();
    if (!container || !legendEl) {
      return;
    }
    const header = container.querySelector(".demographics-header");
    const body = container.querySelector(".demographics-body");
    if (!header || !body) {
      return;
    }

    const GAP_PX = 12; // breathing room between panel bottom and legend

    function apply() {
      const headerRect = header.getBoundingClientRect();
      const legendRect = legendEl.getBoundingClientRect();
      const available = legendRect.top - GAP_PX - headerRect.bottom;
      // Never collapse to nothing — a small floor keeps at least the
      // first section reachable on very short screens.
      body.style.maxHeight = Math.max(96, available) + "px";
      body.style.overflowY = "auto";
    }

    // Defer the first pass so Leaflet has positioned both controls and
    // the pies have laid out.
    requestAnimationFrame(apply);
    map.on("resize", apply);
    window.addEventListener("resize", apply);
  }

  // Single shared marker used for the mouse-following hover tooltip
  // (ward info on the all-wards map, VD number on a single-ward map).
  function createHoverLabelMarker(map) {
    const marker = L.marker(map.getCenter(), {
      icon: L.divIcon({
        className: "hover-label-wrapper",
        html: '<div class="hover-label-inner"></div>',
        iconSize: [0, 0],
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(map);
    hideHoverLabel(marker);
    return marker;
  }

  function getHoverInnerEl(marker) {
    const el = marker.getElement();
    return el ? el.querySelector(".hover-label-inner") : null;
  }

  function hideHoverLabel(marker) {
    const inner = getHoverInnerEl(marker);
    if (inner) {
      inner.style.display = "none";
    }
  }

  function showHoverLabelWith(marker, buildFn) {
    const inner = getHoverInnerEl(marker);
    if (!inner) {
      return;
    }
    while (inner.firstChild) {
      inner.removeChild(inner.firstChild);
    }
    buildFn(inner);
    inner.style.display = "";
  }

  function buildWardHoverContent(el, wardNumber, councillor, population) {
    const title = document.createElement("div");
    title.className = "hover-label-title";
    title.textContent = wardLabel(wardNumber);
    el.appendChild(title);

    if (councillor) {
      const name = document.createElement("div");
      name.textContent = councillor.name;
      el.appendChild(name);

      if (councillor.phone) {
        const phone = document.createElement("div");
        phone.textContent = councillor.phone;
        el.appendChild(phone);
      }
    }

    if (population && typeof population.total === "number") {
      const pop = document.createElement("div");
      pop.textContent = "Population: " + population.total.toLocaleString();
      el.appendChild(pop);
    }
  }

  function buildVdHoverContent(el, vdNumber) {
    const title = document.createElement("div");
    title.className = "hover-label-title";
    title.textContent = "VD " + vdNumber;
    el.appendChild(title);
  }

  // Tracks every rendered ward/VD layer so their outline colour can
  // be switched live when the base layer changes (white on Google
  // Satellite, brand colour otherwise). Fill colour/opacity is left
  // untouched by this — only the stroke colour reacts.
  function createOutlineController() {
    let isSatellite = false;
    const wardLayers = [];
    const vdLayers = [];

    function pick(baseColor) {
      return isSatellite ? "#ffffff" : baseColor;
    }

    return {
      currentWardColor: function () {
        return pick(CONFIG.styles.ward.color);
      },
      currentVdColor: function () {
        return pick(CONFIG.styles.vd.color);
      },
      registerWard: function (layer) {
        wardLayers.push(layer);
      },
      registerVd: function (layer) {
        vdLayers.push(layer);
      },
      applyBaseLayerChange: function (satellite) {
        isSatellite = satellite;
        const wardColor = pick(CONFIG.styles.ward.color);
        const vdColor = pick(CONFIG.styles.vd.color);
        wardLayers.forEach(function (layer) {
          layer.setStyle({ color: wardColor });
        });
        vdLayers.forEach(function (layer) {
          layer.setStyle({ color: vdColor });
        });
      },
    };
  }

  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, "").trim() + ".pdf";
  }

  /* =============================================================
     PDF EXPORT
     Rather than screenshotting the live map with its overlays, the
     PDF is a composed A4-landscape page (see the wireframe): a header
     band (navy municipality name | maroon ward + councillor), a maroon
     demographics column down the left, and the map filling the right.
     The map is captured on its own (overlays hidden, attribution kept),
     dropped into an offscreen DOM laid out like that page, and the
     whole page rasterised to one full-bleed A4 image.
     ============================================================= */

  // A4 landscape at ~5.4 px/mm (297x210mm) - crisp without being huge.
  const PDF_PAGE_W = 1600;
  const PDF_PAGE_H = Math.round((PDF_PAGE_W * 210) / 297); // 1131

  // Composed-page layout metrics (px). Shared by buildPdfPageElement
  // (which lays the page out) and exportWardPdf (which derives the map
  // capture size from them) so the two never drift.
  const PDF_PAD = 28; // white page margin
  const PDF_HEADER_H = 92;
  const PDF_BODY_GAP = 14; // between header and body
  const PDF_DEMO_W = 340; // demographics column width
  const PDF_DEMO_GAP = 14; // between demographics column and map
  const PDF_MAP_BORDER = 1;

  function getActiveTileLayer(map) {
    let tileLayer = null;
    map.eachLayer(function (layer) {
      if (layer instanceof L.TileLayer) {
        tileLayer = layer;
      }
    });
    return tileLayer;
  }

  // Resolves once the base tile layer has finished loading its current
  // view, then waits out Leaflet's tile fade-in. The `load` event fires
  // when tiles finish loading; the settle delay then lets the opacity
  // fade-in (and pruning of stale tiles) complete before capture, so we
  // don't catch half-faded tiles revealing the grey container.
  //
  // The `timeoutMs` fallback must be generous: on the deployed site the
  // re-framed view requests fresh tiles over the network, and capturing
  // before they arrive leaves missing blocks. When the layer isn't
  // loading anything (all tiles already cached) the `load` event won't
  // fire, so we resolve promptly instead of waiting out the timeout.
  function waitForMapIdle(tileLayer, timeoutMs) {
    const FADE_SETTLE_MS = 450; // > Leaflet's ~200ms tile fade
    return new Promise(function (resolve) {
      let settled = false;
      function finish() {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (tileLayer) {
          tileLayer.off("load", onLoad);
        }
        setTimeout(function () {
          requestAnimationFrame(resolve);
        }, FADE_SETTLE_MS);
      }
      function onLoad() {
        finish();
      }
      if (!tileLayer) {
        finish();
        return;
      }
      tileLayer.on("load", onLoad);
      // Nothing pending -> no `load` will come; don't wait for the cap.
      // (_loading is Leaflet-internal but stable for the pinned 1.9.x.)
      if (tileLayer._loading === false) {
        finish();
      }
      const timer = setTimeout(finish, timeoutMs);
    });
  }

  // Captures the map re-framed to the PDF map area's aspect ratio. The
  // live map is temporarily moved into an offscreen holder of the target
  // size and fitBounds() to its *current* visible bounds — so everything
  // on screen stays in frame (plus a little extra on the narrow axis to
  // fill the area, never less), and the result needs neither cropping
  // nor letterboxing. The map's parent keeps its size (no page reflow);
  // the live view (size + center/zoom) is fully restored afterwards.
  //
  // Relies on html2canvas re-fetching tiles with CORS: OSM sends the
  // needed header, but Google's raw satellite endpoint may not, so a
  // capture on that base layer can throw - surfaced to the caller.
  async function captureMapForPdf(map, targetW, targetH) {
    const container = map.getContainer();
    const parent = container.parentNode;
    const nextSibling = container.nextSibling;
    const prevInlineWidth = container.style.width;
    const prevInlineHeight = container.style.height;
    const prevCenter = map.getCenter();
    const prevZoom = map.getZoom();
    const viewBounds = map.getBounds();
    const tileLayer = getActiveTileLayer(map);

    const holder = setStyles(document.createElement("div"), {
      position: "fixed",
      left: "-100000px",
      top: "0",
      width: targetW + "px",
      height: targetH + "px",
      overflow: "hidden",
    });
    document.body.appendChild(holder);

    container.style.width = targetW + "px";
    container.style.height = targetH + "px";
    holder.appendChild(container);
    map.invalidateSize(false);
    map.fitBounds(viewBounds, { animate: false });

    try {
      await waitForMapIdle(tileLayer, 10000);
      return await html2canvas(container, {
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        scale: 2,
        onclone: function (clonedDoc) {
          clonedDoc
            .querySelectorAll(".tools-control, .legend-control, .demographics-control, .data-attribution")
            .forEach(function (el) {
              el.style.display = "none";
            });
          // Force the tile background white and tiles fully opaque in the
          // clone, so a mid-fade tile can never reveal Leaflet's default
          // grey (#ddd) container background as a translucent patch.
          const style = clonedDoc.createElement("style");
          style.textContent =
            ".leaflet-container{background:#fff !important;}" +
            ".leaflet-tile{opacity:1 !important;}";
          (clonedDoc.head || clonedDoc.documentElement).appendChild(style);
        },
      });
    } finally {
      parent.insertBefore(container, nextSibling);
      container.style.width = prevInlineWidth;
      container.style.height = prevInlineHeight;
      holder.remove();
      map.invalidateSize(false);
      map.setView(prevCenter, prevZoom, { animate: false });
    }
  }

  function setStyles(el, styles) {
    Object.keys(styles).forEach(function (k) {
      el.style[k] = styles[k];
    });
    return el;
  }

  // Builds the offscreen page element matching the wireframe. context:
  //   { municipalityText, wardText, councillorText, ... }
  // `demoDataUrl` is the pre-rendered demographics image (or null, e.g.
  // all-wards) — null drops the left column and the map spans full width.
  function buildPdfPageElement(context, mapDataUrl, demoDataUrl) {
    const NAVY = "#002157";
    const MAROON = "#971a32";
    const WHITE = "#ffffff";
    const fontFamily = getComputedStyle(document.body).fontFamily || "sans-serif";

    const page = setStyles(document.createElement("div"), {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: PDF_PAGE_W + "px",
      height: PDF_PAGE_H + "px",
      background: WHITE,
      padding: PDF_PAD + "px",
      boxSizing: "border-box",
      fontFamily: fontFamily,
      display: "flex",
      flexDirection: "column",
    });

    // ---- Header band ----
    // Navy (left, logo) transitions to maroon (right, ward + councillor)
    // through a gold chevron. The tri-colour shape is one SVG (shapes
    // rasterise cleanly in html2canvas); the logo and text sit over it
    // as HTML so the type stays crisp.
    const headerW = PDF_PAGE_W - PDF_PAD * 2;
    const headerH = PDF_HEADER_H;
    const GOLD = "#d7b468";
    const navyRight = Math.round(headerW * 0.6); // navy/maroon split
    const chevronDepth = 64; // how far the point/chevron reaches right
    const midY = headerH / 2;

    const header = setStyles(document.createElement("div"), {
      position: "relative",
      height: headerH + "px",
      flex: "0 0 auto",
      color: WHITE,
      overflow: "hidden",
    });

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + headerW + " " + headerH);
    svg.setAttribute("preserveAspectRatio", "none");
    setStyles(svg, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      display: "block",
    });
    function svgEl(name, attrs) {
      const el = document.createElementNS(svgNS, name);
      Object.keys(attrs).forEach(function (k) {
        el.setAttribute(k, attrs[k]);
      });
      return el;
    }
    // Maroon fills the whole band; navy (with a right-pointing tip) sits
    // on top of the left; the gold chevron traces navy's angled edge.
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: headerW, height: headerH, fill: MAROON }));
    svg.appendChild(svgEl("polygon", {
      points: "0,0 " + navyRight + ",0 " + (navyRight + chevronDepth) + "," + midY +
        " " + navyRight + "," + headerH + " 0," + headerH,
      fill: NAVY,
    }));
    // Extend the chevron's back ends past the top/bottom (along the same
    // lines) so their stroke end-caps fall outside the band and get
    // clipped — otherwise the square caps show as tabs poking into the
    // navy. Within the visible band the chevron is unchanged.
    const chevronExt = 34;
    const chevronBackX = navyRight - (chevronDepth * chevronExt) / midY;
    svg.appendChild(svgEl("polyline", {
      points: chevronBackX + "," + -chevronExt +
        " " + (navyRight + chevronDepth) + "," + midY +
        " " + chevronBackX + "," + (headerH + chevronExt),
      fill: "none",
      stroke: GOLD,
      "stroke-width": 20,
    }));
    header.appendChild(svg);

    // Logo, vertically centred on the navy.
    const logo = setStyles(document.createElement("img"), {
      position: "absolute",
      left: "28px",
      top: "50%",
      transform: "translateY(-50%)",
      height: "52px",
      width: "auto",
      display: "block",
    });
    logo.src = CONFIG.logos.header;
    header.appendChild(logo);

    // Ward + councillor, right-aligned on the maroon.
    const maroonText = setStyles(document.createElement("div"), {
      position: "absolute",
      right: "28px",
      top: "50%",
      transform: "translateY(-50%)",
      textAlign: "right",
    });
    setStyles(maroonText.appendChild(document.createElement("div")), {
      fontSize: "44px",
      fontWeight: "800",
      letterSpacing: "1px",
      lineHeight: "1.05",
    }).textContent = context.wardText;
    if (context.councillorText) {
      setStyles(maroonText.appendChild(document.createElement("div")), {
        fontSize: "26px",
        fontWeight: "600",
        marginTop: "6px",
      }).textContent = context.councillorText;
    }
    header.appendChild(maroonText);
    page.appendChild(header);

    // ---- Body: demographics column (optional) + map ----
    const body = setStyles(document.createElement("div"), {
      display: "flex",
      flex: "1 1 auto",
      marginTop: PDF_BODY_GAP + "px",
      minHeight: "0",
    });

    if (demoDataUrl) {
      const demoCol = setStyles(document.createElement("div"), {
        background: MAROON,
        flex: "0 0 " + PDF_DEMO_W + "px",
        marginRight: PDF_DEMO_GAP + "px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxSizing: "border-box",
      });
      setStyles(demoCol.appendChild(document.createElement("div")), {
        color: WHITE,
        fontWeight: "800",
        fontSize: "22px",
        letterSpacing: "1px",
        padding: "12px 14px 4px",
      }).textContent = "WARD DEMOGRAPHICS";
      // The sections are pre-rendered to one image (captureDemographics-
      // Canvas); it's sized to fit the column by fitPdfDemographicsImage
      // after layout. Scaling an <img> is reliable in html2canvas,
      // whereas a CSS transform on live DOM is not.
      const viewport = setStyles(document.createElement("div"), {
        flex: "1 1 auto",
        overflow: "hidden",
        paddingBottom: "8px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });
      viewport.className = "pdf-demo-viewport";
      const demoImg = setStyles(document.createElement("img"), { display: "block" });
      demoImg.className = "pdf-demo-img";
      demoImg.src = demoDataUrl;
      viewport.appendChild(demoImg);
      demoCol.appendChild(viewport);
      body.appendChild(demoCol);
    }

    // The map image is sized explicitly (see fitPdfMapImage) once the
    // page is in the DOM, because html2canvas doesn't reliably honour
    // object-fit; the flex centring here positions the fitted image.
    const mapArea = setStyles(document.createElement("div"), {
      flex: "1 1 auto",
      background: WHITE,
      border: PDF_MAP_BORDER + "px solid #cccccc",
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    });
    mapArea.className = "pdf-map-area";
    setStyles(mapArea, { position: "relative" });
    const mapImg = setStyles(document.createElement("img"), {
      display: "block",
    });
    mapImg.className = "pdf-map-img";
    mapImg.src = mapDataUrl;
    mapArea.appendChild(mapImg);
    mapArea.appendChild(buildPdfMapLegend(context.includeVd));
    mapArea.appendChild(
      buildPdfMapAttribution(!!(context.demoSections && context.demoSections.length))
    );
    body.appendChild(mapArea);

    page.appendChild(body);
    return page;
  }

  // Compact data-source credits, bottom-left of the map (opposite the
  // Leaflet/OSM tile attribution). Boundaries come from the MDB, voting
  // districts/stations from the IEC, and — when the demographics column
  // is shown — the census figures from Stellenbosch Municipality.
  function buildPdfMapAttribution(hasDemo) {
    const box = setStyles(document.createElement("div"), {
      position: "absolute",
      left: "12px",
      bottom: "12px",
      background: "rgba(255, 255, 255, 0.9)",
      border: "1px solid #999999",
      borderRadius: "3px",
      padding: "5px 8px",
      fontSize: "11px",
      lineHeight: "1.35",
      color: "#333333",
      maxWidth: "320px",
    });
    const lines = [
      "Ward boundaries: Municipal Demarcation Board (MDB)",
      "Voting districts & stations: Electoral Commission (IEC)",
    ];
    if (hasDemo) {
      lines.push("Demographics: Stellenbosch Municipality");
    }
    lines.forEach(function (text) {
      box.appendChild(document.createElement("div")).textContent = text;
    });
    return box;
  }

  // Style-key box for the PDF map (bottom-right, black border, black
  // labels), raised above the Leaflet/OSM attribution baked into the map
  // image. Reuses appendLegendRow so the swatches match the app exactly:
  // ward-boundary square, optional voting-district square, voting-station
  // dot. `includeVd` mirrors the on-screen legend (VDs only on the
  // single-ward map).
  function buildPdfMapLegend(includeVd) {
    const box = setStyles(document.createElement("div"), {
      position: "absolute",
      right: "14px",
      bottom: "34px",
      background: "#ffffff",
      border: "2px solid #000000",
      borderRadius: "3px",
      padding: "8px 12px",
      fontSize: "15px",
      lineHeight: "1.3",
      color: "#000000",
    });
    appendLegendRow(box, "Ward boundary", {
      shape: "square",
      swatchBorderColor: CONFIG.styles.ward.color,
      swatchFillColor: hexWithAlpha(CONFIG.styles.ward.color, CONFIG.styles.fillOpacity),
      textColor: "#000000",
    });
    if (includeVd) {
      appendLegendRow(box, "Voting District", {
        shape: "square",
        swatchBorderColor: CONFIG.styles.vd.color,
        swatchFillColor: hexWithAlpha(CONFIG.styles.vd.color, CONFIG.styles.vdFillOpacity),
        textColor: "#000000",
      });
    }
    appendLegendRow(box, "Voting Station", {
      shape: "circle",
      swatchBorderColor: "#ffffff",
      swatchFillColor: CONFIG.styles.station.color,
      textColor: "#000000",
    });
    return box;
  }

  // Sizes the map <img> to COVER its area (fills it completely, cropping
  // the overflow) while preserving the captured map's aspect ratio. The
  // area is flex-centred with overflow hidden, so the crop is symmetric
  // — the centre of the on-screen view stays the centre of the printed
  // map. Called after the page is attached so the area has real dims.
  function fitPdfMapImage(pageEl, mapCanvas) {
    const area = pageEl.querySelector(".pdf-map-area");
    const img = pageEl.querySelector(".pdf-map-img");
    if (!area || !img || !mapCanvas.width || !mapCanvas.height) {
      return;
    }
    const scale = Math.max(
      area.clientWidth / mapCanvas.width,
      area.clientHeight / mapCanvas.height
    );
    img.style.width = mapCanvas.width * scale + "px";
    img.style.height = mapCanvas.height * scale + "px";
  }

  // Renders the demographics sections to a single canvas (maroon card
  // stack) so the composed page can place them as one image. Doing this
  // instead of scaling live DOM sidesteps html2canvas's unreliable
  // CSS-transform handling — an <img> scales predictably.
  async function captureDemographicsCanvas(sections) {
    const MAROON = "#971a32";
    const holder = setStyles(document.createElement("div"), {
      position: "fixed",
      left: "-100000px",
      top: "0",
      width: PDF_DEMO_W + "px",
      background: MAROON,
      paddingBottom: "8px",
      boxSizing: "border-box",
      fontFamily: getComputedStyle(document.body).fontFamily || "sans-serif",
    });
    sections.forEach(function (section) {
      holder.appendChild(buildDemographicSection(section));
    });
    document.body.appendChild(holder);
    try {
      return await html2canvas(holder, {
        useCORS: true,
        backgroundColor: MAROON,
        logging: false,
        scale: 2,
      });
    } finally {
      document.body.removeChild(holder);
    }
  }

  // Sizes the pre-rendered demographics image to fit its column (contain,
  // centred) preserving aspect. When the sections are taller than the
  // column they scale down as one image — reliably, unlike a live-DOM
  // transform. Called after the page is attached so the area has real dims.
  function fitPdfDemographicsImage(pageEl, demoCanvas) {
    const area = pageEl.querySelector(".pdf-demo-viewport");
    const img = pageEl.querySelector(".pdf-demo-img");
    if (!area || !img || !demoCanvas.width || !demoCanvas.height) {
      return;
    }
    const areaW = area.clientWidth;
    const areaH = area.clientHeight;
    const aspect = demoCanvas.width / demoCanvas.height;
    let w = areaW;
    let h = areaW / aspect;
    if (h > areaH) {
      h = areaH;
      w = areaH * aspect;
    }
    img.style.width = w + "px";
    img.style.height = h + "px";
  }

  // Pixel size of the map area within the composed page, derived from
  // the shared layout constants. The map is captured at exactly this
  // aspect ratio so it drops in with no crop and no letterbox.
  function pdfMapAreaSize(hasDemo) {
    return {
      width:
        PDF_PAGE_W - PDF_PAD * 2 -
        (hasDemo ? PDF_DEMO_W + PDF_DEMO_GAP : 0) -
        PDF_MAP_BORDER * 2,
      height: PDF_PAGE_H - PDF_PAD * 2 - PDF_HEADER_H - PDF_BODY_GAP - PDF_MAP_BORDER * 2,
    };
  }

  // Orchestrates the capture (map re-framed to the PDF aspect, then the
  // composed page) and saves the PDF. `context` supplies the header /
  // demographics content, built per-mode via toolsControl.setPdfContext.
  // A loading overlay covers the map area while its container is briefly
  // moved offscreen for the re-framed capture.
  async function exportWardPdf(map, context) {
    if (typeof html2canvas !== "function" || !window.jspdf) {
      window.alert("PDF export isn't available right now - the required libraries didn't load. Check your internet connection and try again.");
      return;
    }

    const hasDemo = !!(context.demoSections && context.demoSections.length);
    const area = pdfMapAreaSize(hasDemo);

    setStatusMessage("Preparing the PDF…");
    showLoadingOverlay(true);

    try {
      let mapCanvas;
      try {
        mapCanvas = await captureMapForPdf(map, area.width, area.height);
      } catch (err) {
        console.error("PDF map capture failed:", err);
        window.alert(
          "Sorry, the PDF could not be generated. This usually happens when the Google Satellite base layer is " +
          "active, since its map tiles can't reliably be captured this way - try switching to OpenStreetMap " +
          "and downloading again."
        );
        return;
      }

      // Pre-render the demographics sections to one image (if any).
      let demoCanvas = null;
      if (context.demoSections && context.demoSections.length) {
        demoCanvas = await captureDemographicsCanvas(context.demoSections);
      }

      const pageEl = buildPdfPageElement(
        context,
        mapCanvas.toDataURL("image/png"),
        demoCanvas ? demoCanvas.toDataURL("image/png") : null
      );
      document.body.appendChild(pageEl);
      fitPdfMapImage(pageEl, mapCanvas);
      if (demoCanvas) {
        fitPdfDemographicsImage(pageEl, demoCanvas);
      }

      try {
        const pageCanvas = await html2canvas(pageEl, {
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
        });
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        doc.addImage(pageCanvas.toDataURL("image/png"), "PNG", 0, 0, 297, 210);
        doc.save(sanitizeFilename(document.title));
      } catch (err) {
        console.error("PDF compose failed:", err);
        window.alert("Sorry, the PDF could not be generated. Please try again.");
      } finally {
        document.body.removeChild(pageEl);
      }
    } finally {
      showLoadingOverlay(false);
    }
  }

  // "Zoom to Area" tool: click to arm it (cursor becomes a crosshair
  // and ward/VD/station interactivity is suspended, so a drag can't
  // also trigger a hover-highlight or click-to-navigate underneath
  // it), drag a rectangle on the map, and it zooms to fit exactly
  // that box — landing on the precise zoom the box implies rather
  // than snapping to the nearest whole level, thanks to zoomSnap: 0
  // set on the map. Auto-disarms itself once a box is successfully
  // drawn (a single-shot tool); clicking the button again disarms it
  // early, without needing to draw a box at all.
  function createZoomAreaTool(map, toggleButton) {
    let active = false;
    let startPoint = null;
    let boxEl = null;

    function positionBox(p1, p2) {
      const minX = Math.min(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      L.DomUtil.setPosition(boxEl, L.point(minX, minY));
      boxEl.style.width = Math.abs(p2.x - p1.x) + "px";
      boxEl.style.height = Math.abs(p2.y - p1.y) + "px";
    }

    function onMouseMove(e) {
      if (!boxEl) {
        return;
      }
      positionBox(startPoint, map.mouseEventToContainerPoint(e));
    }

    function onMouseUp(e) {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      const endPoint = map.mouseEventToContainerPoint(e);
      if (boxEl) {
        L.DomUtil.remove(boxEl);
        boxEl = null;
      }

      // A near-zero-size drag is just a click, not a deliberate box —
      // ignore it (stay armed) rather than zooming to a sliver.
      if (Math.abs(endPoint.x - startPoint.x) < 5 || Math.abs(endPoint.y - startPoint.y) < 5) {
        return;
      }

      const bounds = L.latLngBounds(
        map.containerPointToLatLng(startPoint),
        map.containerPointToLatLng(endPoint)
      );
      map.fitBounds(bounds);
      setActive(false);
    }

    function onMouseDown(e) {
      if (e.button !== 0) {
        return; // left click/primary touch only
      }
      startPoint = map.mouseEventToContainerPoint(e);
      boxEl = L.DomUtil.create("div", "zoom-area-box", map.getContainer());
      positionBox(startPoint, startPoint);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      L.DomEvent.preventDefault(e);
    }

    function setPaneInteractive(paneName, interactive) {
      const pane = map.getPane(paneName);
      if (pane) {
        pane.style.pointerEvents = interactive ? "" : "none";
      }
    }

    function setActive(next) {
      active = next;
      const container = map.getContainer();

      if (active) {
        // Disabling dragging removes Leaflet's own pan-start listener
        // entirely (rather than merely ignoring it), so it can't race
        // with this tool's own mousedown handler for the same event.
        map.dragging.disable();
        setPaneInteractive("overlayPane", false);
        setPaneInteractive("stationsPane", false);
        L.DomUtil.addClass(container, "zoom-area-active");
        container.addEventListener("mousedown", onMouseDown);
      } else {
        L.DomUtil.removeClass(container, "zoom-area-active");
        container.removeEventListener("mousedown", onMouseDown);
        map.dragging.enable();
        setPaneInteractive("overlayPane", true);
        setPaneInteractive("stationsPane", true);
        if (boxEl) {
          L.DomUtil.remove(boxEl);
          boxEl = null;
        }
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      }

      toggleButton.classList.toggle("tools-action-active", active);
    }

    return {
      toggle: function () {
        setActive(!active);
      },
    };
  }

  // Custom top-left "Tools" control — replaces Leaflet's default
  // zoom control and the native layers control entirely, so all
  // layer-visibility toggling below goes through map.addLayer()/
  // removeLayer() directly rather than Leaflet's own control events.
  function createToolsControl(map, base, outline) {
    const control = L.control({ position: "topleft" });

    let containerEl = null;
    let bodyEl = null;
    let actionsEl = null;
    let overlayListEl = null;
    let selectAllInput = null;
    let collapsed = false;
    let homeBounds = null;
    // Returns the { municipalityText, wardText, councillorText,
    // demoSections } context for the PDF export; set per mode.
    let pdfContextProvider = null;
    const overlayEntries = []; // { layerGroup, input }

    function buildActionRow(iconSrc, label, onClick) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tools-action-row";

      const iconWrap = document.createElement("span");
      iconWrap.className = "tools-action-icon";
      const img = document.createElement("img");
      img.src = iconSrc;
      img.alt = "";
      iconWrap.appendChild(img);
      button.appendChild(iconWrap);

      const text = document.createElement("span");
      text.textContent = label;
      button.appendChild(text);

      // onClick may return a Promise (e.g. PDF generation) — while
      // it's pending, disable the row so it can't be triggered twice
      // and show a subtle busy state. Synchronous actions (zoom,
      // recenter) are unaffected since they return nothing.
      button.addEventListener("click", function () {
        if (button.disabled) {
          return;
        }
        const result = onClick();
        if (result && typeof result.then === "function") {
          button.disabled = true;
          button.classList.add("tools-action-busy");
          result.finally(function () {
            button.disabled = false;
            button.classList.remove("tools-action-busy");
          });
        }
      });

      return button;
    }

    function buildOptionRow(type, name, checked, label, onChange) {
      const row = document.createElement("label");
      row.className = "tools-panel-row";

      const input = document.createElement("input");
      input.type = type;
      if (name) {
        input.name = name;
      }
      input.checked = checked;
      row.appendChild(input);

      const text = document.createElement("span");
      text.textContent = label;
      row.appendChild(text);

      input.addEventListener("change", function () {
        onChange(input.checked);
      });

      return { row: row, input: input };
    }

    function updateSelectAllState() {
      if (!selectAllInput || overlayEntries.length === 0) {
        return;
      }
      const checkedCount = overlayEntries.filter(function (e) {
        return e.input.checked;
      }).length;
      selectAllInput.checked = checkedCount === overlayEntries.length;
      selectAllInput.indeterminate = checkedCount > 0 && checkedCount < overlayEntries.length;
    }

    function ensureSelectAllRow() {
      if (selectAllInput) {
        return;
      }
      const built = buildOptionRow("checkbox", null, true, "Select/Deselect All", function (isChecked) {
        overlayEntries.forEach(function (entry) {
          if (entry.input.checked !== isChecked) {
            entry.input.checked = isChecked;
            if (isChecked) {
              map.addLayer(entry.layerGroup);
            } else {
              map.removeLayer(entry.layerGroup);
            }
          }
        });
      });
      selectAllInput = built.input;
      overlayListEl.appendChild(built.row);
    }

    control.onAdd = function () {
      containerEl = L.DomUtil.create("div", "tools-control");
      L.DomEvent.disableClickPropagation(containerEl);
      L.DomEvent.disableScrollPropagation(containerEl);

      const header = document.createElement("div");
      header.className = "tools-header";

      // Collapse/expand affordance on the left of the header. It's a
      // CSS-drawn chevron (see .tools-header-toggle) that rotates with
      // the .tools-collapsed state — no extra icon asset needed. The
      // whole header stays clickable; this is purely a visual cue.
      const toggleIcon = document.createElement("span");
      toggleIcon.className = "tools-header-toggle";
      toggleIcon.setAttribute("aria-hidden", "true");
      header.appendChild(toggleIcon);

      const headerLabel = document.createElement("span");
      headerLabel.className = "tools-header-label";
      headerLabel.textContent = "Tools";
      header.appendChild(headerLabel);

      header.addEventListener("click", function () {
        collapsed = !collapsed;
        containerEl.classList.toggle("tools-collapsed", collapsed);
      });
      containerEl.appendChild(header);

      bodyEl = document.createElement("div");
      bodyEl.className = "tools-body";
      containerEl.appendChild(bodyEl);

      const actions = document.createElement("div");
      actions.className = "tools-actions";
      actionsEl = actions;
      actions.appendChild(buildActionRow(CONFIG.icons.zoomIn, "Zoom in", function () {
        map.zoomIn();
      }));
      actions.appendChild(buildActionRow(CONFIG.icons.zoomOut, "Zoom out", function () {
        map.zoomOut();
      }));
      const zoomAreaButton = buildActionRow(CONFIG.icons.zoomArea, "Zoom to area", function () {
        zoomAreaTool.toggle();
      });
      const zoomAreaTool = createZoomAreaTool(map, zoomAreaButton);
      actions.appendChild(zoomAreaButton);
      actions.appendChild(buildActionRow(CONFIG.icons.recenter, "Recenter", function () {
        if (homeBounds) {
          map.fitBounds(homeBounds, { padding: CONFIG.fitBoundsPadding });
        }
      }));
      actions.appendChild(buildActionRow(CONFIG.icons.downloadPdf, "Download PDF", function () {
        const context = pdfContextProvider
          ? pdfContextProvider()
          : { municipalityText: CONFIG.municipalityName.toUpperCase(), wardText: "", councillorText: "", demoSections: null };
        return exportWardPdf(map, context);
      }));
      bodyEl.appendChild(actions);

      const basePanel = document.createElement("div");
      basePanel.className = "tools-panel";
      const osmRow = buildOptionRow("radio", "baseLayer", true, "Open Street Map", function (checked) {
        if (!checked) {
          return;
        }
        map.removeLayer(base.googleSat);
        map.addLayer(base.osm);
        outline.applyBaseLayerChange(false);
      });
      const satRow = buildOptionRow("radio", "baseLayer", false, "Google Satellite", function (checked) {
        if (!checked) {
          return;
        }
        map.removeLayer(base.osm);
        map.addLayer(base.googleSat);
        outline.applyBaseLayerChange(true);
      });
      basePanel.appendChild(osmRow.row);
      basePanel.appendChild(satRow.row);
      bodyEl.appendChild(basePanel);

      overlayListEl = document.createElement("div");
      overlayListEl.className = "tools-panel";
      overlayListEl.hidden = true;
      bodyEl.appendChild(overlayListEl);

      return containerEl;
    };

    control.setHomeBounds = function (bounds) {
      homeBounds = bounds;
    };

    // Supplies the per-mode content for the PDF export (see
    // exportWardPdf). `fn` returns the context object each time the
    // Download PDF action runs, so it always reflects current data.
    control.setPdfContext = function (fn) {
      pdfContextProvider = fn;
    };

    // Appends an extra action row below the built-in ones (Zoom in …
    // Download PDF). Used by single-ward mode to add "All wards"
    // navigation, which doesn't belong on the all-wards map itself.
    control.addAction = function (iconSrc, label, onClick) {
      if (actionsEl) {
        actionsEl.appendChild(buildActionRow(iconSrc, label, onClick));
      }
    };

    // Mirrors L.control.layers' addOverlay(layer, name) signature so
    // call sites don't need to change beyond the variable name.
    control.addOverlay = function (layerGroup, name) {
      overlayListEl.hidden = false;
      ensureSelectAllRow();
      const checked = map.hasLayer(layerGroup);
      const built = buildOptionRow("checkbox", null, checked, name, function (isChecked) {
        if (isChecked) {
          map.addLayer(layerGroup);
        } else {
          map.removeLayer(layerGroup);
        }
        updateSelectAllState();
      });
      overlayEntries.push({ layerGroup: layerGroup, input: built.input });
      overlayListEl.appendChild(built.row);
      updateSelectAllState();
    };

    return control;
  }

  function createMap() {
    const map = L.map("map", {
      zoomControl: false,
      // Continuous zoom rather than Leaflet's default whole-integer
      // steps. Without this, fitBounds() (used for the initial ward
      // view, Recenter, and the zoom-to-area tool below) can only
      // land on the nearest *lower* integer zoom that keeps the
      // whole target on screen — which is often noticeably looser
      // than the tightest fit, especially for an odd-shaped ward.
      // With zoomSnap: 0 it lands on the exact fractional zoom the
      // bounds call for; Leaflet's tile rendering supports fractional
      // zoom natively (it just scales the nearest integer zoom's
      // tiles), so this has no functional downside.
      zoomSnap: 0,
      // Leaflet's default SVG vector renderer uses a viewBox-offset
      // trick for efficient panning that html2canvas is well known
      // to misinterpret (ward/VD polygons end up shifted toward the
      // top-left, or entirely off-canvas) — this is a documented
      // Leaflet/html2canvas incompatibility, not specific to this
      // app. Canvas rendering draws pixels directly with no such
      // indirection, so it captures correctly; hover/click behaviour
      // is unaffected since Leaflet's canvas renderer implements the
      // same interactive event handling as its SVG renderer.
      preferCanvas: true,
    }).setView(
      [CONFIG.initialView.lat, CONFIG.initialView.lng],
      CONFIG.initialView.zoom
    );

    // Voting station markers get their own pane, above the default
    // overlayPane (z-index 400) that ward/VD polygons render in.
    // Without this, station markers and polygons share one pane and
    // stack purely by DOM insertion order — since VD polygons and
    // their stations are added in an interleaved loop, a later VD's
    // polygon can end up covering an earlier VD's station, blocking
    // clicks on it. A dedicated higher-z pane makes stations always
    // click-through-able regardless of add order.
    const stationsPane = map.createPane("stationsPane");
    stationsPane.style.zIndex = 450;

    // The single-ward map's ward boundary is drawn over the VD
    // outlines, in its own pane above the default overlayPane the
    // ward fill and the VDs share. Its canvas covers the whole map
    // and (see the stationsPane note above) would swallow every
    // hover and click on the VDs underneath, so the pane is made
    // click-through — nothing in it is interactive anyway.
    const wardOutlinePane = map.createPane("wardOutlinePane");
    wardOutlinePane.style.zIndex = 420;
    wardOutlinePane.style.pointerEvents = "none";

    const base = createBaseLayers();
    base.osm.addTo(map);

    const outline = createOutlineController();
    const toolsControl = createToolsControl(map, base, outline).addTo(map);
    const legend = createLegendControl().addTo(map);
    const hoverLabel = createHoverLabelMarker(map);

    return { map: map, toolsControl: toolsControl, legend: legend, hoverLabel: hoverLabel, outline: outline };
  }

  /* =============================================================
     6. FEATURE STYLES & GEOMETRY CONVERSION
     ============================================================= */

  // Style factories take the outline controller so the outline
  // colour reflects the *current* base layer (white on satellite)
  // even for layers created after a base-layer switch.
  function makeWardStyle(outline) {
    return function () {
      return {
        color: outline.currentWardColor(),
        weight: CONFIG.styles.weight,
        opacity: 1,
        fillColor: CONFIG.styles.ward.color,
        fillOpacity: CONFIG.styles.fillOpacity,
      };
    };
  }

  // The single-ward map draws the ward polygon twice: this fill-only
  // copy underneath everything, and an outline-only copy (next
  // function) on top of the VD layer. Splitting them is what keeps the ward
  // boundary visible — VD outlines run along the same pixels, so a
  // single ward polygon painted under them would have its boundary
  // completely covered.
  function makeWardFillStyle() {
    return function () {
      return {
        stroke: false,
        fillColor: CONFIG.styles.ward.color,
        fillOpacity: CONFIG.styles.fillOpacity,
      };
    };
  }

  function makeWardOutlineStyle(outline) {
    return function () {
      return {
        color: outline.currentWardColor(),
        weight: CONFIG.styles.wardOutlineWeight,
        opacity: 1,
        fill: false,
      };
    };
  }

  function makeVdStyle(outline) {
    return function () {
      return {
        color: outline.currentVdColor(),
        weight: CONFIG.styles.weight,
        opacity: 1,
        fillColor: CONFIG.styles.vd.color,
        fillOpacity: CONFIG.styles.vdFillOpacity,
      };
    };
  }

  // Voting stations are markers (small HTML elements), not a Path/
  // circleMarker — deliberately so. With preferCanvas: true, every
  // Path-based layer in a given pane shares ONE opaque <canvas>
  // covering the whole map; a higher-z-index pane's canvas then
  // intercepts mouse events across its *entire* area regardless of
  // what's actually drawn where, blocking clicks/hovers on anything
  // underneath (this is exactly what broke ward hover/click on the
  // all-wards map once stations rendered). A marker's icon is always
  // its own small, precisely-hit-tested DOM element, so it can sit
  // above the ward/VD canvas without blocking anything beside itself.
  function createStationMarker(lat, lng) {
    return L.marker([lat, lng], {
      icon: L.divIcon({
        className: "station-marker-icon",
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
      pane: "stationsPane",
      keyboard: false,
    });
  }

  function wardLabel(wardNumber) {
    return "Ward " + wardNumber;
  }

  // Converts a raw IEC "Geometry" value into a GeoJSON geometry
  // object Leaflet can render, or returns null if absent/unrecognised.
  // NOTE: the real populated shape hasn't been confirmed against a
  // live example yet — this defensively handles GeoJSON or Esri
  // "rings" JSON and otherwise skips the polygon rather than guess.
  function convertIecGeometryToGeoJSON(geometry) {
    if (!geometry) {
      return null;
    }

    if (geometry.type === "FeatureCollection" && Array.isArray(geometry.features)) {
      return geometry;
    }
    if (geometry.type === "Feature" && geometry.geometry) {
      return geometry;
    }
    if (geometry.type && geometry.coordinates) {
      return geometry;
    }

    if (Array.isArray(geometry.rings)) {
      return { type: "Polygon", coordinates: geometry.rings };
    }

    console.warn("Unrecognised IEC geometry shape, skipping polygon:", geometry);
    return null;
  }

  function buildStationPopupContent(station, vdNumber) {
    const container = document.createElement("div");
    container.className = "station-popup";

    const name = document.createElement("strong");
    name.textContent = station.Name || "Voting station";
    container.appendChild(name);

    const vdLine = document.createElement("div");
    vdLine.textContent = "VD " + vdNumber;
    container.appendChild(vdLine);

    const addressParts = [station.StreetName, station.Suburb, station.Town].filter(Boolean);
    if (addressParts.length > 0) {
      const address = document.createElement("div");
      address.textContent = addressParts.join(", ");
      container.appendChild(address);
    }

    if (station.Type) {
      const type = document.createElement("div");
      type.className = "station-type";
      type.textContent = station.Type;
      container.appendChild(type);
    }

    return container;
  }

  /* =============================================================
     7. DEFAULT (NON-HOVER) FEATURE LABELS
     Placed at an interior point of the on-screen-visible portion of
     each feature (so a label always sits inside its own polygon, even
     for concave wards when zoomed/panned), hidden if the label doesn't
     fit that visible area, and hidden on overlap with a higher-priority
     label already placed. Can be wholly suppressed during a hover
     interaction and resumed after.
     ============================================================= */

  function clipBoundsToView(bounds, viewBounds) {
    const south = Math.max(bounds.getSouth(), viewBounds.getSouth());
    const north = Math.min(bounds.getNorth(), viewBounds.getNorth());
    const west = Math.max(bounds.getWest(), viewBounds.getWest());
    const east = Math.min(bounds.getEast(), viewBounds.getEast());
    if (south >= north || west >= east) {
      return null;
    }
    return L.latLngBounds([south, west], [north, east]);
  }

  function boundsPixelSize(map, bounds) {
    const nw = map.latLngToContainerPoint(bounds.getNorthWest());
    const se = map.latLngToContainerPoint(bounds.getSouthEast());
    return { width: Math.abs(se.x - nw.x), height: Math.abs(se.y - nw.y) };
  }

  // Flattens any Polygon/MultiPolygon (or Feature/FeatureCollection
  // wrapping one) into a flat list of rings, each an array of
  // [lng, lat] pairs. Holes and the separate parts of a MultiPolygon
  // all become rings in the same list — the even-odd point-in-polygon
  // test below handles both correctly.
  function extractPolygonRings(geometry) {
    if (!geometry) {
      return [];
    }
    if (geometry.type === "Feature") {
      return extractPolygonRings(geometry.geometry);
    }
    if (geometry.type === "FeatureCollection") {
      const rings = [];
      (geometry.features || []).forEach(function (f) {
        Array.prototype.push.apply(rings, extractPolygonRings(f.geometry));
      });
      return rings;
    }
    if (geometry.type === "Polygon") {
      return geometry.coordinates.slice();
    }
    if (geometry.type === "MultiPolygon") {
      const rings = [];
      geometry.coordinates.forEach(function (poly) {
        Array.prototype.push.apply(rings, poly);
      });
      return rings;
    }
    return [];
  }

  // Even-odd ray-casting test against pixel-projected rings.
  function pointInProjectedRings(x, y, projectedRings) {
    let inside = false;
    projectedRings.forEach(function (ring) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i].x, yi = ring[i].y;
        const xj = ring[j].x, yj = ring[j].y;
        const intersect =
          (yi > y) !== (yj > y) &&
          x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersect) {
          inside = !inside;
        }
      }
    });
    return inside;
  }

  function distToSegment(px, py, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  // Distance from a point to the nearest ring edge (any ring).
  function distToProjectedRings(x, y, projectedRings) {
    let min = Infinity;
    projectedRings.forEach(function (ring) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const d = distToSegment(x, y, ring[i], ring[j]);
        if (d < min) {
          min = d;
        }
      }
    });
    return min;
  }

  // Point where segment a→b crosses the axis-aligned line
  // (axis "x": vertical line at coord; axis "y": horizontal at coord).
  function intersectAxis(a, b, coord, axis) {
    if (axis === "x") {
      const t = (coord - a.x) / (b.x - a.x);
      return { x: coord, y: a.y + t * (b.y - a.y) };
    }
    const t = (coord - a.y) / (b.y - a.y);
    return { x: a.x + t * (b.x - a.x), y: coord };
  }

  // Sutherland–Hodgman clip of a projected ring against the axis-aligned
  // viewport rectangle. Returns the ring of the on-screen portion (may
  // be empty if the ring is fully off screen). The viewport is convex,
  // so this single-pass clip is exact.
  function clipRingToRect(ring, rect) {
    const clips = [
      { keep: function (p) { return p.x >= rect.minX; }, axis: "x", coord: rect.minX },
      { keep: function (p) { return p.x <= rect.maxX; }, axis: "x", coord: rect.maxX },
      { keep: function (p) { return p.y >= rect.minY; }, axis: "y", coord: rect.minY },
      { keep: function (p) { return p.y <= rect.maxY; }, axis: "y", coord: rect.maxY },
    ];
    let output = ring;
    clips.forEach(function (clip) {
      const input = output;
      output = [];
      for (let i = 0; i < input.length; i++) {
        const cur = input[i];
        const prev = input[(i + input.length - 1) % input.length];
        const curIn = clip.keep(cur);
        const prevIn = clip.keep(prev);
        if (curIn) {
          if (!prevIn) {
            output.push(intersectAxis(prev, cur, clip.coord, clip.axis));
          }
          output.push(cur);
        } else if (prevIn) {
          output.push(intersectAxis(prev, cur, clip.coord, clip.axis));
        }
      }
    });
    return output;
  }

  // Returns the label anchor: the pole of inaccessibility of the
  // *on-screen* part of the feature — the interior point farthest from
  // that region's boundary. Keeps a label inside its own (often concave
  // / L-shaped) ward even when only a corner of the ward is in view.
  //
  // The polygon is first clipped to the viewport so the grid search
  // runs over a tight box around the visible portion; searching the raw
  // (possibly huge, mostly-off-screen) feature bbox is what previously
  // let a thin visible sliver slip between grid points and the label
  // fall back to a centre outside the ward / over a neighbour. Returns
  // null when no interior of the feature is currently on screen, so the
  // caller can hide the label rather than misplace it.
  function findInteriorLabelPoint(map, rings) {
    if (!rings || rings.length === 0) {
      return null;
    }

    const size = map.getSize();
    const rect = { minX: 0, minY: 0, maxX: size.x, maxY: size.y };

    // Project to pixels, clip each ring to the viewport, and track the
    // bounding box of everything that survives. Even-odd tests below run
    // against the clipped rings, so holes / multipolygon parts and the
    // viewport cut edges are all handled together.
    const clippedRings = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rings.forEach(function (ring) {
      const projected = ring.map(function (coord) {
        return map.latLngToContainerPoint(L.latLng(coord[1], coord[0]));
      });
      const clipped = clipRingToRect(projected, rect);
      if (clipped.length < 3) {
        return;
      }
      clippedRings.push(clipped);
      clipped.forEach(function (p) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
    });
    if (clippedRings.length === 0 || maxX <= minX || maxY <= minY) {
      return null;
    }

    function search(x0, y0, x1, y1, steps) {
      let best = null;
      let bestDist = -Infinity;
      const stepX = (x1 - x0) / steps;
      const stepY = (y1 - y0) / steps;
      for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps; j++) {
          const x = x0 + stepX * i;
          const y = y0 + stepY * j;
          if (!pointInProjectedRings(x, y, clippedRings)) {
            continue;
          }
          const d = distToProjectedRings(x, y, clippedRings);
          if (d > bestDist) {
            bestDist = d;
            best = { x: x, y: y, stepX: stepX, stepY: stepY };
          }
        }
      }
      return best;
    }

    // Coarse grid over the tight visible box, then one refinement pass
    // within the winning cell for sub-cell accuracy.
    const coarse = search(minX, minY, maxX, maxY, 20);
    if (!coarse) {
      return null;
    }
    const rx = Math.abs(coarse.stepX);
    const ry = Math.abs(coarse.stepY);
    const fine =
      search(coarse.x - rx, coarse.y - ry, coarse.x + rx, coarse.y + ry, 8) ||
      coarse;

    return map.containerPointToLatLng(L.point(fine.x, fine.y));
  }

  // entries: [{ bounds, text, color, layerGroup, geometry? }] —
  // priority is array order (earlier entries win when labels would
  // overlap). `geometry` (a GeoJSON Polygon/MultiPolygon) is optional;
  // when present, labels are placed at an interior point of the visible
  // feature rather than the bounding-box centre.
  function createLabelController(map, entries) {
    let suppressed = false;

    const ringsByEntry = entries.map(function (entry) {
      return extractPolygonRings(entry.geometry);
    });

    const markers = entries.map(function (entry) {
      const marker = L.marker(entry.bounds.getCenter(), {
        icon: L.divIcon({
          className: "feature-label-wrapper",
          html: '<div class="feature-label-inner"></div>',
          iconSize: [0, 0],
        }),
        interactive: false,
        keyboard: false,
      });
      entry.layerGroup.addLayer(marker);
      return marker;
    });

    function hideMarker(marker) {
      const el = marker.getElement();
      if (el) {
        el.style.display = "none";
      }
    }

    function showMarker(marker) {
      const el = marker.getElement();
      if (el) {
        el.style.display = "";
      }
    }

    function reposition() {
      if (suppressed) {
        return;
      }

      const viewBounds = map.getBounds();
      const placedRects = [];

      entries.forEach(function (entry, i) {
        const marker = markers[i];
        if (!map.hasLayer(marker)) {
          return; // this feature's layer is currently toggled off
        }

        const clipped = clipBoundsToView(entry.bounds, viewBounds);
        if (!clipped) {
          hideMarker(marker);
          return;
        }

        // Anchor the label at an interior point of the visible feature
        // so it always sits inside its own polygon. When the feature
        // has geometry but none of its interior is on screen, hide the
        // label rather than placing it at a bounding-box centre that
        // could land outside the ward or over a neighbour. Only fall
        // back to the visible-bbox centre when no geometry was supplied.
        let anchor;
        if (ringsByEntry[i].length > 0) {
          anchor = findInteriorLabelPoint(map, ringsByEntry[i]);
          if (!anchor) {
            hideMarker(marker);
            return;
          }
        } else {
          anchor = clipped.getCenter();
        }
        marker.setLatLng(anchor);
        showMarker(marker);

        const el = marker.getElement();
        if (!el) {
          return;
        }
        const inner = el.querySelector(".feature-label-inner");
        if (!inner) {
          return;
        }
        if (!inner.dataset.textSet) {
          inner.textContent = entry.text;
          inner.style.color = entry.color;
          inner.dataset.textSet = "1";
        }

        const pxSize = boundsPixelSize(map, clipped);
        const rect = inner.getBoundingClientRect();

        if (rect.width > pxSize.width || rect.height > pxSize.height) {
          hideMarker(marker);
          return;
        }

        const myRect = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        const overlapsExisting = placedRects.some(function (r) {
          return !(myRect.right < r.left || myRect.left > r.right || myRect.bottom < r.top || myRect.top > r.bottom);
        });

        if (overlapsExisting) {
          hideMarker(marker);
          return;
        }

        placedRects.push(myRect);
      });
    }

    map.on("moveend zoomend", reposition);

    // layeradd/layerremove fire once per individual sub-layer (every
    // station marker, every label marker...), not once per checkbox
    // toggle — coalesce bursts of them into a single reposition pass
    // on the next frame rather than running it dozens of times over.
    let repositionScheduled = false;
    map.on("layeradd layerremove", function () {
      if (repositionScheduled) {
        return;
      }
      repositionScheduled = true;
      requestAnimationFrame(function () {
        repositionScheduled = false;
        reposition();
      });
    });

    reposition();

    return {
      reposition: reposition,
      suppress: function () {
        suppressed = true;
        markers.forEach(hideMarker);
      },
      resume: function () {
        suppressed = false;
        reposition();
      },
      // Hide a single feature's label (by entry index) without
      // touching the others — used on the all-wards map so hovering
      // one ward only drops that ward's own label (its info moves to
      // the following tooltip), leaving every other label in place.
      hideLabel: function (index) {
        const marker = markers[index];
        if (marker) {
          hideMarker(marker);
        }
      },
      // Restore normal placement after a hideLabel().
      showLabels: function () {
        reposition();
      },
    };
  }

  /* =============================================================
     8. HOVER BEHAVIOUR
     ============================================================= */

  /* =============================================================
     5c. WARD INSIGHTS (all-wards choropleth)
     Top-right control that shades every ward from min to max for a
     chosen metric, with a switchable colour scheme and a gradient
     legend. Only the fill colour/opacity changes, so it composes with
     the outline controller and per-ward toggles. Wards with no data
     (e.g. ward 23) are shaded neutral grey and excluded from the range.
     ============================================================= */

  const INSIGHT_FILL_OPACITY = 0.75;
  const INSIGHT_HOVER_OPACITY = 0.92;
  const INSIGHT_NODATA_COLOR = "#c9ccd1";

  // Sequential ramps (light -> dark end). Viridis is perceptually
  // uniform and colour-blind friendly; Blues matches the app's navy.
  const INSIGHT_RAMPS = {
    viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
    blues: ["#eff3ff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"],
    bluered: ["#2166ac", "#92c5de", "#f7f7f7", "#f4a582", "#b2182b"],
  };
  const INSIGHT_SCHEME_LABELS = { viridis: "Viridis", blues: "Blues", bluered: "Blue–Red" };
  const INSIGHT_QUANTILE_CLASSES = 5;

  // Sums the percentages whose label matches. Returns 0 (not null) when
  // the ward has data in this list but nothing matches — e.g. a ward
  // with only formal housing genuinely has ~0% informal dwellings, which
  // is the low end of the ramp, not "no data". Only a list with no
  // numeric data at all (ward 23) yields null.
  function insightPctFromList(list, matchFn) {
    if (!Array.isArray(list)) {
      return null;
    }
    let sum = 0;
    let matched = false;
    let hasData = false;
    list.forEach(function (item) {
      if (item && typeof item.percentage === "number") {
        hasData = true;
        if (matchFn(String(item.label))) {
          sum += item.percentage;
          matched = true;
        }
      }
    });
    if (matched) {
      return sum;
    }
    return hasData ? 0 : null;
  }

  function insightFormatPct(v) {
    return Math.round(v * 10) / 10 + "%";
  }

  // Percentage of a named population group for a ward, or null.
  function insightGroupPct(w, re) {
    const groups = w.demo && w.demo.population_groups;
    if (!Array.isArray(groups)) {
      return null;
    }
    let val = null;
    groups.forEach(function (g) {
      if (g && re.test(String(g.label)) && typeof g.percentage === "number") {
        val = g.percentage;
      }
    });
    return val;
  }

  // Summed share of the monthly-income bands whose upper bound is at
  // most `maxRand` (parses the last number out of labels like
  // "R1 601 – R3 200"). A proxy: income is only the top few bands per
  // ward, so treat "has income data but no low band" as 0, not null.
  function insightIncomeAtMost(w, maxRand) {
    const cats = w.demo && w.demo.monthly_income && w.demo.monthly_income.categories;
    if (!Array.isArray(cats)) {
      return null;
    }
    let sum = 0;
    let hasData = false;
    cats.forEach(function (c) {
      if (c && typeof c.percentage === "number") {
        hasData = true;
        const parts = String(c.label).split(/[–-]/);
        const upper = parseInt(parts[parts.length - 1].replace(/[^\d]/g, ""), 10);
        if (isFinite(upper) && upper <= maxRand) {
          sum += c.percentage;
        }
      }
    });
    return hasData ? sum : null;
  }

  // Simpson diversity index (1 - Σpᵢ²): 0 = one group dominates,
  // ~0.75 = an even four-group mix.
  function insightDiversity(w) {
    const groups = w.demo && w.demo.population_groups;
    if (!Array.isArray(groups)) {
      return null;
    }
    let sumSq = 0;
    let any = false;
    groups.forEach(function (g) {
      if (g && typeof g.percentage === "number") {
        const p = g.percentage / 100;
        sumSq += p * p;
        any = true;
      }
    });
    return any ? 1 - sumSq : null;
  }

  // Each metric pulls one number per ward from { demo, area, population }
  // and belongs to a `group` (rendered as a subheading). `scale` is
  // linear except where the spread is extreme (density, area -> log).
  const INSIGHT_METRICS = [
    // --- Population & space ---
    {
      key: "density", group: "Population & space", label: "Population density", scale: "log",
      value: function (w) { return w.area > 0 && w.population > 0 ? w.population / w.area : null; },
      format: function (v) { return Math.round(v).toLocaleString() + " /km²"; },
    },
    {
      key: "population", group: "Population & space", label: "Total population", scale: "linear",
      value: function (w) { return typeof w.population === "number" && w.population > 0 ? w.population : null; },
      format: function (v) { return Math.round(v).toLocaleString(); },
    },
    {
      key: "area", group: "Population & space", label: "Ward area", scale: "log",
      value: function (w) { return typeof w.area === "number" && w.area > 0 ? w.area : null; },
      format: function (v) { return (Math.round(v * 100) / 100).toLocaleString() + " km²"; },
    },
    {
      key: "working_age", group: "Population & space", label: "Working age (15–64)", scale: "linear",
      value: function (w) {
        const a = w.demo && w.demo.age_demographics && w.demo.age_demographics.age_15_64;
        return a && typeof a.percentage === "number" ? a.percentage : null;
      },
      format: insightFormatPct,
    },
    {
      key: "diversity", group: "Population & space", label: "Population diversity", scale: "linear",
      value: insightDiversity,
      format: function (v) { return (Math.round(v * 100) / 100).toString(); },
    },
    // --- Economy ---
    {
      key: "unemployment", group: "Economy", label: "Unemployment", scale: "linear",
      value: function (w) { return insightPctFromList(w.demo && w.demo.employment, function (l) { return /unemploy/i.test(l); }); },
      format: insightFormatPct,
    },
    {
      key: "low_income", group: "Economy", label: "Lower income (≤ R3 200)", scale: "linear",
      value: function (w) { return insightIncomeAtMost(w, 3200); },
      format: insightFormatPct,
    },
    // --- Education (ages 20+) ---
    {
      key: "no_matric", group: "Education (20+)", label: "No matric", scale: "linear",
      value: function (w) { return insightPctFromList(w.demo && w.demo.education && w.demo.education.categories, function (l) { return /no matric/i.test(l); }); },
      format: insightFormatPct,
    },
    {
      key: "matriculated", group: "Education (20+)", label: "Matriculated", scale: "linear",
      value: function (w) { return insightPctFromList(w.demo && w.demo.education && w.demo.education.categories, function (l) { return /matriculated/i.test(l); }); },
      format: insightFormatPct,
    },
    {
      key: "higher_ed", group: "Education (20+)", label: "Higher education", scale: "linear",
      value: function (w) { return insightPctFromList(w.demo && w.demo.education && w.demo.education.categories, function (l) { return /higher/i.test(l); }); },
      format: insightFormatPct,
    },
    // --- Housing ---
    {
      key: "informal", group: "Housing", label: "Informal dwellings", scale: "linear",
      value: function (w) { return insightPctFromList(w.demo && w.demo.dwelling, function (l) { return /informal/i.test(l); }); },
      format: insightFormatPct,
    },
    {
      key: "formal", group: "Housing", label: "Formal (brick/concrete)", scale: "linear",
      value: function (w) { return insightPctFromList(w.demo && w.demo.dwelling, function (l) { return /brick/i.test(l); }); },
      format: insightFormatPct,
    },
    // --- Population groups ---
    {
      key: "black_african", group: "Population groups", label: "Black African", scale: "linear",
      value: function (w) { return insightGroupPct(w, /black/i); },
      format: insightFormatPct,
    },
    {
      key: "coloured", group: "Population groups", label: "Coloured", scale: "linear",
      value: function (w) { return insightGroupPct(w, /coloured/i); },
      format: insightFormatPct,
    },
    {
      key: "white", group: "Population groups", label: "White", scale: "linear",
      value: function (w) { return insightGroupPct(w, /white/i); },
      format: insightFormatPct,
    },
  ];

  function insightLerpColor(a, b, t) {
    function ch(hex, i) {
      return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
    }
    const r = Math.round(ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t);
    const g = Math.round(ch(a, 1) + (ch(b, 1) - ch(a, 1)) * t);
    const bl = Math.round(ch(a, 2) + (ch(b, 2) - ch(a, 2)) * t);
    return "rgb(" + r + "," + g + "," + bl + ")";
  }

  function insightRampColor(stops, t) {
    const c = Math.max(0, Math.min(1, t));
    const pos = c * (stops.length - 1);
    const i = Math.floor(pos);
    if (i >= stops.length - 1) {
      return stops[stops.length - 1];
    }
    return insightLerpColor(stops[i], stops[i + 1], pos - i);
  }

  function insightNormalize(v, min, max, scale) {
    if (min === max) {
      return 0.5;
    }
    if (scale === "log" && min > 0 && v > 0) {
      return (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min));
    }
    return (v - min) / (max - min);
  }

  // Equal-count (quantile) classification: sorts the values into k
  // classes with roughly equal membership and returns value -> ramp
  // position (one of k discrete steps). Better than linear for skewed
  // metrics, where one extreme ward would otherwise flatten the rest.
  function insightQuantileClasser(values, k) {
    const sorted = values.slice().sort(function (a, b) {
      return a - b;
    });
    const n = sorted.length;
    const breaks = [];
    for (let i = 1; i < k; i++) {
      breaks.push(sorted[Math.min(Math.floor((i * n) / k), n - 1)]);
    }
    function classOf(v) {
      let cls = 0;
      for (let i = 0; i < breaks.length; i++) {
        if (v >= breaks[i]) {
          cls = i + 1;
        }
      }
      return cls;
    }
    return {
      breaks: breaks,
      tOf: function (v) {
        return k > 1 ? classOf(v) / (k - 1) : 0.5;
      },
    };
  }

  // `wards`: [{ wardNumber, layer, demo, area, population }].
  // `insightState` is shared with the hover so the tooltip can show the
  // active metric's value and restore the right fill opacity.
  function createWardInsightsControl(map, wards, insightState) {
    const metricsByKey = {};
    INSIGHT_METRICS.forEach(function (m) {
      metricsByKey[m.key] = m;
    });
    let scheme = "viridis";
    let classification = "continuous"; // or "quantile"
    let activeKey = null;
    let legendWrap, legendTitle, legendBody;

    function restoreDefault() {
      wards.forEach(function (w) {
        w.layer.setStyle({
          fillColor: CONFIG.styles.ward.color,
          fillOpacity: CONFIG.styles.fillOpacity,
        });
      });
    }

    // Continuous mode -> a smooth gradient bar with min/max labels.
    // Quantile mode -> one swatch per class with its value range, since
    // the shading is discrete and the class breaks are the useful info.
    function updateLegend(metric, min, max, stops, quantile) {
      if (!legendWrap) {
        return;
      }
      legendWrap.hidden = false;
      legendTitle.textContent = metric.label;
      while (legendBody.firstChild) {
        legendBody.removeChild(legendBody.firstChild);
      }

      if (quantile) {
        const k = INSIGHT_QUANTILE_CLASSES;
        const bounds = [min].concat(quantile.breaks, [max]); // k+1 edges
        for (let i = k - 1; i >= 0; i--) {
          // High class at the top.
          const row = document.createElement("div");
          row.className = "insights-class-row";
          const sw = document.createElement("span");
          sw.className = "insights-class-swatch";
          sw.style.background = insightRampColor(stops, k > 1 ? i / (k - 1) : 0.5);
          const txt = document.createElement("span");
          txt.textContent = metric.format(bounds[i]) + " – " + metric.format(bounds[i + 1]);
          row.appendChild(sw);
          row.appendChild(txt);
          legendBody.appendChild(row);
        }
        return;
      }

      const grad = document.createElement("div");
      grad.className = "insights-gradient";
      grad.style.background = "linear-gradient(to right, " + stops.join(", ") + ")";
      legendBody.appendChild(grad);
      const scale = document.createElement("div");
      scale.className = "insights-legend-scale";
      const mn = document.createElement("span");
      mn.textContent = metric.format(min);
      const mx = document.createElement("span");
      mx.textContent = metric.format(max);
      scale.appendChild(mn);
      scale.appendChild(mx);
      legendBody.appendChild(scale);
    }

    // Voting-station icons clutter a shaded map, so hide them (via a
    // container class — purely visual, so it doesn't fight the Tools
    // box's Voting Stations toggle) whenever a metric is active.
    function setStationsHidden(hidden) {
      map.getContainer().classList.toggle("insights-choropleth-active", hidden);
    }

    function apply() {
      if (!activeKey) {
        restoreDefault();
        setStationsHidden(false);
        insightState.activeKey = null;
        insightState.metric = null;
        insightState.valueByWard = {};
        if (legendWrap) {
          legendWrap.hidden = true;
        }
        return;
      }
      const metric = metricsByKey[activeKey];
      const valueByWard = {};
      const values = [];
      wards.forEach(function (w) {
        const v = metric.value(w);
        const num = typeof v === "number" && isFinite(v) ? v : null;
        valueByWard[w.wardNumber] = num;
        if (num != null) {
          values.push(num);
        }
      });
      const min = values.length ? Math.min.apply(null, values) : 0;
      const max = values.length ? Math.max.apply(null, values) : 0;
      const stops = INSIGHT_RAMPS[scheme];
      // "continuous" uses the metric's own scale (linear/log); "quantile"
      // buckets the wards into equal-count classes.
      const quantile = classification === "quantile" && values.length
        ? insightQuantileClasser(values, INSIGHT_QUANTILE_CLASSES)
        : null;
      wards.forEach(function (w) {
        const v = valueByWard[w.wardNumber];
        let color;
        if (v == null) {
          color = INSIGHT_NODATA_COLOR;
        } else {
          const t = quantile ? quantile.tOf(v) : insightNormalize(v, min, max, metric.scale);
          color = insightRampColor(stops, t);
        }
        w.layer.setStyle({ fillColor: color, fillOpacity: INSIGHT_FILL_OPACITY });
      });
      setStationsHidden(true);
      insightState.activeKey = activeKey;
      insightState.metric = metric;
      insightState.valueByWard = valueByWard;
      updateLegend(metric, min, max, stops, quantile);
    }

    const control = L.control({ position: "topright" });

    control.onAdd = function () {
      const containerEl = L.DomUtil.create("div", "insights-control insights-collapsed");
      L.DomEvent.disableClickPropagation(containerEl);
      L.DomEvent.disableScrollPropagation(containerEl);
      let collapsed = true;

      const header = document.createElement("div");
      header.className = "insights-header";
      const toggleIcon = document.createElement("span");
      toggleIcon.className = "insights-header-toggle";
      toggleIcon.setAttribute("aria-hidden", "true");
      header.appendChild(toggleIcon);
      const headerLabel = document.createElement("span");
      headerLabel.className = "insights-header-label";
      headerLabel.textContent = "Ward Insights";
      header.appendChild(headerLabel);
      header.addEventListener("click", function () {
        collapsed = !collapsed;
        containerEl.classList.toggle("insights-collapsed", collapsed);
      });
      containerEl.appendChild(header);

      const body = document.createElement("div");
      body.className = "insights-body";

      const schemeHead = document.createElement("div");
      schemeHead.className = "insights-subhead";
      schemeHead.textContent = "Colour scheme";
      body.appendChild(schemeHead);

      const schemeRow = document.createElement("div");
      schemeRow.className = "insights-schemes";
      Object.keys(INSIGHT_RAMPS).forEach(function (key) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "insights-scheme" + (key === scheme ? " insights-scheme-active" : "");
        btn.style.background = "linear-gradient(to right, " + INSIGHT_RAMPS[key].join(", ") + ")";
        btn.title = INSIGHT_SCHEME_LABELS[key];
        btn.addEventListener("click", function () {
          scheme = key;
          schemeRow.querySelectorAll(".insights-scheme").forEach(function (b) {
            b.classList.remove("insights-scheme-active");
          });
          btn.classList.add("insights-scheme-active");
          apply();
        });
        schemeRow.appendChild(btn);
      });
      body.appendChild(schemeRow);

      // Classification toggle: continuous (metric's own scale) vs
      // quantile (equal-count classes; better for skewed metrics).
      const classHead = document.createElement("div");
      classHead.className = "insights-subhead";
      classHead.textContent = "Classification";
      body.appendChild(classHead);

      const classRow = document.createElement("div");
      classRow.className = "insights-classes";
      [
        { key: "continuous", label: "Continuous" },
        { key: "quantile", label: "Quantile" },
      ].forEach(function (opt) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "insights-class" + (opt.key === classification ? " insights-class-active" : "");
        btn.textContent = opt.label;
        btn.addEventListener("click", function () {
          classification = opt.key;
          classRow.querySelectorAll(".insights-class").forEach(function (b) {
            b.classList.remove("insights-class-active");
          });
          btn.classList.add("insights-class-active");
          apply();
        });
        classRow.appendChild(btn);
      });
      body.appendChild(classRow);

      const metricList = document.createElement("div");
      metricList.className = "insights-metrics";
      function addRadio(key, label) {
        const row = document.createElement("label");
        row.className = "insights-metric-row";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "insight-metric";
        input.checked = key === (activeKey || "");
        input.addEventListener("change", function () {
          activeKey = key || null;
          apply();
        });
        const span = document.createElement("span");
        span.textContent = label;
        row.appendChild(input);
        row.appendChild(span);
        metricList.appendChild(row);
      }
      addRadio("", "None (default)");
      let lastGroup = null;
      INSIGHT_METRICS.forEach(function (m) {
        if (m.group && m.group !== lastGroup) {
          const gh = document.createElement("div");
          gh.className = "insights-metric-group";
          gh.textContent = m.group;
          metricList.appendChild(gh);
          lastGroup = m.group;
        }
        addRadio(m.key, m.label);
      });
      body.appendChild(metricList);

      legendWrap = document.createElement("div");
      legendWrap.className = "insights-legend";
      legendWrap.hidden = true;
      legendTitle = document.createElement("div");
      legendTitle.className = "insights-legend-title";
      legendWrap.appendChild(legendTitle);
      // Rebuilt per render as either a gradient or class swatches.
      legendBody = document.createElement("div");
      legendBody.className = "insights-legend-body";
      legendWrap.appendChild(legendBody);
      body.appendChild(legendWrap);

      containerEl.appendChild(body);
      return containerEl;
    };

    return control;
  }

  // All-wards map: hovering a ward reduces its transparency, hides
  // every default ward label, and shows a mouse-following tooltip with
  // the ward's number, councillor, population, and — when a Ward
  // Insights metric is active — that metric's value. `insightState`
  // also governs the base/hover fill opacity so the choropleth shading
  // survives hover-out.
  function attachWardHoverBehavior(layer, wardNumber, councillor, population, hoverLabel, labelController, labelIndex, insightState) {
    function baseOpacity() {
      return insightState && insightState.activeKey ? INSIGHT_FILL_OPACITY : CONFIG.styles.fillOpacity;
    }
    function hoverOpacity() {
      return insightState && insightState.activeKey ? INSIGHT_HOVER_OPACITY : CONFIG.styles.hoverFillOpacity;
    }
    layer.on("mouseover", function () {
      layer.setStyle({ fillOpacity: hoverOpacity() });
      labelController.hideLabel(labelIndex);
      showHoverLabelWith(hoverLabel, function (el) {
        buildWardHoverContent(el, wardNumber, councillor, population);
        if (insightState && insightState.activeKey && insightState.metric) {
          const v = insightState.valueByWard[wardNumber];
          const line = document.createElement("div");
          line.className = "hover-label-insight";
          line.textContent =
            insightState.metric.label + ": " + (v == null ? "no data" : insightState.metric.format(v));
          el.appendChild(line);
        }
      });
    });
    layer.on("mousemove", function (e) {
      hoverLabel.setLatLng(e.latlng);
    });
    layer.on("mouseout", function () {
      layer.setStyle({ fillOpacity: baseOpacity() });
      hideHoverLabel(hoverLabel);
      labelController.showLabels();
    });
  }

  // Adds/removes the pulse class on a voting district's station
  // markers. A marker only has a DOM element while it is on the map,
  // so this is a no-op for stations hidden via the Tools overlay
  // toggle.
  function setStationPulse(stationMarkers, on) {
    (stationMarkers || []).forEach(function (marker) {
      const el = marker.getElement();
      if (el) {
        el.classList.toggle("station-marker-pulsing", on);
      }
    });
  }

  // Single-ward map: hovering a voting district makes it less
  // transparent, shows a mouse-following "VD N" tooltip, hides the
  // default VD labels, and pulses the district's own voting-station
  // markers so the pairing is obvious.
  function attachVdHoverBehavior(layer, vdNumber, hoverLabel, labelController, stationMarkers) {
    layer.on("mouseover", function () {
      layer.setStyle({ fillOpacity: CONFIG.styles.vdHoverFillOpacity });
      setStationPulse(stationMarkers, true);
      labelController.suppress();
      showHoverLabelWith(hoverLabel, function (el) {
        buildVdHoverContent(el, vdNumber);
      });
    });
    layer.on("mousemove", function (e) {
      hoverLabel.setLatLng(e.latlng);
    });
    layer.on("mouseout", function () {
      layer.setStyle({ fillOpacity: CONFIG.styles.vdFillOpacity });
      setStationPulse(stationMarkers, false);
      hideHoverLabel(hoverLabel);
      labelController.resume();
    });
  }

  // All-wards map: clicking a ward navigates to its single-ward map.
  function attachWardClickNavigation(layer, wardNumber) {
    layer.on("click", function () {
      window.location.href = "index.html?ward=" + wardNumber;
    });
  }

  /* =============================================================
     9. UI UPDATES (page chrome, not the map itself)
     ============================================================= */

  function setPageTitle(wardNumber) {
    document.title = "Stellenbosch Ward " + wardNumber;
  }

  // The header now shows a static site title; the ward name lives in
  // the browser tab title (setPageTitle) and the legend. This stays as
  // a null-safe no-op so the existing call sites don't need touching
  // and a heading element can be reintroduced later without changes.
  function setHeading(text) {
    const el = document.getElementById("ward-heading");
    if (el) {
      el.textContent = text;
    }
  }

  function setStatusMessage(text) {
    document.getElementById("status-message").textContent = text;
  }

  function showLoadingOverlay(visible) {
    document.getElementById("status").hidden = !visible;
  }

  function showMapArea(visible) {
    document.getElementById("map-area").hidden = !visible;
  }

  function showError(message) {
    showMapArea(false);
    document.getElementById("error-message").textContent = message;
    document.getElementById("error").hidden = false;
  }

  function setIecNotice(text) {
    const el = document.getElementById("iec-notice");
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.textContent = text;
    el.hidden = false;
  }

  /* =============================================================
     10. MODE ORCHESTRATION
     ============================================================= */

  function describeAllWardsIecNotice(vdList, failureCount, totalWards) {
    if (failureCount === totalWards) {
      return "Voting district data is currently unavailable.";
    }
    if (failureCount > 0) {
      return "Voting district data could not be loaded for " + failureCount + " of " + totalWards + " wards.";
    }
    if (vdList.length === 0) {
      return "No voting districts were found.";
    }
    return null;
  }

  async function runSingleWardMode(wardNumber, context) {
    const map = context.map;
    const toolsControl = context.toolsControl;
    const legend = context.legend;
    const hoverLabel = context.hoverLabel;
    const outline = context.outline;

    setPageTitle(wardNumber);
    setHeading(wardLabel(wardNumber));
    setStatusMessage("Loading ward boundary\u2026");

    // Single-ward-only Tools action: jump back to the all-wards map.
    toolsControl.addAction(CONFIG.icons.allWards, "All wards", function () {
      window.location.href = "index.html?ward=" + CONFIG.allWardsParam;
    });

    const mdbPromise = fetchWardGeoJSON(wardNumber);
    const iecPromise = fetchVotingDistricts(wardNumber);
    const refPromise = fetchReferenceData();

    let mdbFailed = false;
    let refData = { councillorsByWardNo: {}, populationByWardNo: {}, demographicsByWardNo: {}, areaByWardNo: {} };
    try {
      refData = await refPromise;
    } catch (err) {
      console.warn("Reference data (councillors/population) failed to load:", err);
    }

    // Primary: the municipal ward boundary.
    try {
      const geojson = await mdbPromise;

      const wardLayerGroup = L.layerGroup().addTo(map);
      // Two copies of the same boundary (see makeWardFillStyle): the
      // fill sits under the VD layer, the outline over it, so the
      // ward boundary stays legible where VD edges run along it.
      const wardPolygon = L.geoJSON(geojson, { style: makeWardFillStyle() }).addTo(wardLayerGroup);
      const wardOutlinePolygon = L.geoJSON(geojson, {
        style: makeWardOutlineStyle(outline),
        pane: "wardOutlinePane",
        interactive: false,
      }).addTo(wardLayerGroup);
      outline.registerWard(wardOutlinePolygon);

      const bounds = wardPolygon.getBounds();
      if (!bounds.isValid()) {
        throw new Error("empty");
      }

      map.invalidateSize();
      map.fitBounds(bounds, { padding: CONFIG.fitBoundsPadding });
      toolsControl.setHomeBounds(bounds);

      toolsControl.addOverlay(wardLayerGroup, wardLabel(wardNumber));
      showLoadingOverlay(false);

      const wardNo = buildWardNo(wardNumber);
      const councillor = refData.councillorsByWardNo[wardNo] || null;
      legend.update(function (el) {
        buildSingleWardLegendContent(el, wardNumber, councillor);
      });

      // Top-right demographics panel (added only when there's data),
      // height-capped so it never overlaps the bottom-right legend.
      const demoEntry = refData.demographicsByWardNo[wardNo];
      const totalPopulation = sumPopulation(refData.populationByWardNo);
      const wardArea = refData.areaByWardNo[wardNo];
      const demoControl = createDemographicsControl(wardNumber, demoEntry, totalPopulation, wardArea);
      if (demoControl) {
        demoControl.addTo(map);
        fitDemographicsPanelToLegend(map, demoControl, legend);
      }

      createDataAttributionControl(!!demoControl).addTo(map);

      // PDF export content for this ward (header + demographics column).
      toolsControl.setPdfContext(function () {
        const councillorText = councillor
          ? councillor.name + (councillor.phone ? "  ·  " + councillor.phone : "")
          : "";
        const demoSections = demoEntry && demoEntry.demographics
          ? buildDemographicSections(demoEntry.demographics, {
              wardNumber: wardNumber,
              wardPopulation: demoEntry.population,
              totalPopulation: totalPopulation,
              wardArea: wardArea,
            })
          : null;
        return {
          municipalityText: CONFIG.municipalityName.toUpperCase(),
          wardText: "WARD " + wardNumber + " (" + new Date().getFullYear() + ")",
          councillorText: councillorText,
          demoSections: demoSections,
          includeVd: true,
        };
      });
    } catch (err) {
      mdbFailed = true;
      const reason = err && ERROR_MESSAGES[err.message] ? err.message : "network";
      showError(ERROR_MESSAGES[reason]);
      map.remove();
    }

    // Secondary: IEC voting districts and voting stations.
    try {
      const vdList = await iecPromise;
      if (!mdbFailed) {
        const vdLayerGroup = L.layerGroup().addTo(map);
        const stationLayerGroup = L.layerGroup().addTo(map);
        const vdEntries = [];

        vdList.slice().sort(function (a, b) {
          return String(a.VDNumber).localeCompare(String(b.VDNumber));
        }).forEach(function (vd) {
          const geojsonGeom = convertIecGeometryToGeoJSON(vd.Geometry);
          // The district's own station markers, so hovering the
          // district can pulse them (attachVdHoverBehavior).
          const stationMarkers = [];
          if (geojsonGeom) {
            const vdPolygon = L.geoJSON(geojsonGeom, { style: makeVdStyle(outline) }).addTo(vdLayerGroup);
            outline.registerVd(vdPolygon);
            const vdBounds = vdPolygon.getBounds();
            if (vdBounds.isValid()) {
              vdEntries.push({
                bounds: vdBounds,
                text: "VD " + vd.VDNumber,
                color: CONFIG.styles.vd.color,
                layerGroup: vdLayerGroup,
                layer: vdPolygon,
                geometry: geojsonGeom,
                vdNumber: vd.VDNumber,
                stationMarkers: stationMarkers,
              });
            }
          }

          (vd.VotingStation || []).forEach(function (station) {
            const lat = parseFloat(station.Latitude);
            const lng = parseFloat(station.Longitude);
            if (!isFinite(lat) || !isFinite(lng)) {
              return;
            }
            const marker = createStationMarker(lat, lng).addTo(stationLayerGroup);
            marker.bindPopup(buildStationPopupContent(station, vd.VDNumber));
            stationMarkers.push(marker);
          });
        });

        const vdLabelController = createLabelController(map, vdEntries);
        vdEntries.forEach(function (entry) {
          attachVdHoverBehavior(entry.layer, entry.vdNumber, hoverLabel, vdLabelController, entry.stationMarkers);
        });

        toolsControl.addOverlay(vdLayerGroup, "Voting Districts");
        toolsControl.addOverlay(stationLayerGroup, "Voting Stations");

        if (vdList.length === 0) {
          setIecNotice("No voting districts were found for this ward.");
        }
      }
    } catch (err) {
      console.warn("IEC voting district fetch failed:", err);
      if (!mdbFailed) {
        setIecNotice("Voting district data is currently unavailable.");
      }
    }
  }

  async function runAllWardsMode(context) {
    const map = context.map;
    const toolsControl = context.toolsControl;
    const legend = context.legend;
    const hoverLabel = context.hoverLabel;
    const outline = context.outline;

    document.title = "Stellenbosch \u2014 All Wards";
    setHeading("All Wards");
    setStatusMessage("Loading all ward boundaries\u2026");

    const mdbPromise = fetchAllWardsGeoJSON();
    const iecPromise = fetchAllVotingDistricts();
    const refPromise = fetchReferenceData();

    let mdbFailed = false;
    let refData = { councillorsByWardNo: {}, populationByWardNo: {}, demographicsByWardNo: {}, areaByWardNo: {} };
    try {
      refData = await refPromise;
    } catch (err) {
      console.warn("Reference data (councillors/population) failed to load:", err);
    }

    const totalPopulation = sumPopulation(refData.populationByWardNo);
    legend.update(function (el) {
      buildAllWardsLegendContent(el, totalPopulation);
    });

    try {
      const geojson = await mdbPromise;

      const combinedBounds = L.latLngBounds([]);
      const wardEntries = [];

      (geojson.features || [])
        .slice()
        .sort(function (a, b) {
          const aNo = Number((a.properties && a.properties.WardNo) || 0);
          const bNo = Number((b.properties && b.properties.WardNo) || 0);
          return aNo - bNo;
        })
        .forEach(function (feature) {
          const props = (feature && feature.properties) || {};
          const wardNumber = Number(props.WardNo);
          if (!wardNumber) {
            return;
          }
          // WardID comes from the service; fall back to building it in
          // case a future republish drops the field.
          const wardNo = props.WardID ? String(props.WardID) : buildWardNo(wardNumber);
          const wardLayerGroup = L.layerGroup().addTo(map);
          // className adds a pointer cursor (see .ward-clickable in
          // CSS) — only these all-wards polygons navigate on click,
          // not the single-ward map's own ward outline.
          const clickableStyle = makeWardStyle(outline)();
          clickableStyle.className = "ward-clickable";
          const wardPolygon = L.geoJSON(feature, { style: clickableStyle }).addTo(wardLayerGroup);
          outline.registerWard(wardPolygon);
          const bounds = wardPolygon.getBounds();
          if (!bounds.isValid()) {
            return;
          }
          combinedBounds.extend(bounds);

          wardEntries.push({
            bounds: bounds,
            text: wardLabel(wardNumber),
            color: CONFIG.styles.ward.color,
            layerGroup: wardLayerGroup,
            layer: wardPolygon,
            geometry: feature.geometry,
            wardNumber: wardNumber,
            wardNo: wardNo,
          });

          toolsControl.addOverlay(wardLayerGroup, wardLabel(wardNumber));
        });

      if (!combinedBounds.isValid()) {
        throw new Error("empty");
      }

      map.invalidateSize();
      map.fitBounds(combinedBounds, { padding: CONFIG.fitBoundsPadding });
      toolsControl.setHomeBounds(combinedBounds);

      // No demographics on the all-wards map, so no demographics credit.
      createDataAttributionControl(false).addTo(map);

      // PDF export content for the all-wards map: header only (no
      // single councillor, no demographics column — map spans full).
      toolsControl.setPdfContext(function () {
        return {
          municipalityText: CONFIG.municipalityName.toUpperCase(),
          wardText: "ALL WARDS (" + new Date().getFullYear() + ")",
          councillorText: "",
          demoSections: null,
          includeVd: false,
        };
      });

      // Ward Insights choropleth (top-right). Shared state lets the
      // hover tooltip show the active metric and keep the shading.
      const insightState = { activeKey: null, metric: null, valueByWard: {} };
      const insightWards = wardEntries.map(function (entry) {
        const de = refData.demographicsByWardNo[entry.wardNo];
        const pop = refData.populationByWardNo[entry.wardNo];
        return {
          wardNumber: entry.wardNumber,
          layer: entry.layer,
          demo: de && de.demographics ? de.demographics : null,
          area: refData.areaByWardNo[entry.wardNo],
          population: de && typeof de.population === "number"
            ? de.population
            : pop && typeof pop.total === "number" ? pop.total : null,
        };
      });
      createWardInsightsControl(map, insightWards, insightState).addTo(map);

      const wardLabelController = createLabelController(map, wardEntries);
      wardEntries.forEach(function (entry, index) {
        const councillor = refData.councillorsByWardNo[entry.wardNo] || null;
        const population = refData.populationByWardNo[entry.wardNo] || null;
        attachWardHoverBehavior(entry.layer, entry.wardNumber, councillor, population, hoverLabel, wardLabelController, index, insightState);
        attachWardClickNavigation(entry.layer, entry.wardNumber);
      });

      showLoadingOverlay(false);
    } catch (err) {
      mdbFailed = true;
      const reason = err && ERROR_MESSAGES[err.message] ? err.message : "network";
      showError(ERROR_MESSAGES[reason]);
      map.remove();
    }

    // Stations only — VD polygons are intentionally not rendered on
    // the all-wards map, per spec ("show only wards and stations").
    try {
      const result = await iecPromise;
      if (!mdbFailed) {
        const stationLayerGroup = L.layerGroup().addTo(map);
        result.vdList.forEach(function (vd) {
          (vd.VotingStation || []).forEach(function (station) {
            const lat = parseFloat(station.Latitude);
            const lng = parseFloat(station.Longitude);
            if (!isFinite(lat) || !isFinite(lng)) {
              return;
            }
            const marker = createStationMarker(lat, lng).addTo(stationLayerGroup);
            marker.bindPopup(buildStationPopupContent(station, vd.VDNumber));
          });
        });
        toolsControl.addOverlay(stationLayerGroup, "Voting Stations");

        const notice = describeAllWardsIecNotice(result.vdList, result.failureCount, result.totalWards);
        if (notice) {
          setIecNotice(notice);
        }
      }
    } catch (err) {
      console.warn("IEC voting district fetch failed:", err);
      if (!mdbFailed) {
        setIecNotice("Voting district data is currently unavailable.");
      }
    }
  }

  // First-visit disclaimer: shown once per browser session (remembered via
  // sessionStorage, so it returns on the user's next visit but not on
  // reloads/navigation within the same session), dismissed by the Continue
  // button. Fails open — if storage is unavailable it simply shows each visit.
  function initDisclaimer() {
    const overlay = document.getElementById("disclaimer");
    if (!overlay) {
      return;
    }
    const KEY = "wardmap-disclaimer-ack";
    let acked = false;
    try {
      // Clean up the key left by the earlier localStorage version, so
      // visitors who dismissed it back then are shown it again. Kept in
      // its own try so a failure here can't skip the session check below.
      window.localStorage.removeItem(KEY);
    } catch (err) {
      /* ignore */
    }
    try {
      acked = window.sessionStorage.getItem(KEY) === "1";
    } catch (err) {
      /* storage blocked (private mode) — show it */
    }
    if (acked) {
      return;
    }
    overlay.hidden = false;

    function dismiss() {
      overlay.hidden = true;
      document.removeEventListener("keydown", onKey);
      try {
        window.sessionStorage.setItem(KEY, "1");
      } catch (err) {
        /* ignore */
      }
    }
    function onKey(e) {
      if (e.key === "Escape") {
        dismiss();
      }
    }
    document.addEventListener("keydown", onKey);
    // Backdrop click (on the overlay itself, not the card) dismisses.
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) {
        dismiss();
      }
    });
    const btn = document.getElementById("disclaimer-continue");
    if (btn) {
      btn.focus();
      btn.addEventListener("click", dismiss);
    }
  }

  async function main() {
    initDisclaimer();

    const rawWard = getWardParamFromLocation();
    const validation = validateWardParam(rawWard);

    if (!validation.valid) {
      setHeading("Stellenbosch Ward Map");
      showError(ERROR_MESSAGES[validation.reason]);
      return;
    }

    // Unhide the map container *before* creating the Leaflet map —
    // Leaflet measures its container's on-screen size at construction
    // time, and initializing it while still display:none caches a
    // 0x0 size and produces a collapsed, mis-zoomed map.
    showMapArea(true);
    const context = createMap();

    if (validation.mode === "all") {
      await runAllWardsMode(context);
    } else {
      await runSingleWardMode(validation.wardNumber, context);
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();