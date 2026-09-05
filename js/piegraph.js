/*
   Ward Explorer — an interactive map of the electoral wards of
   Stellenbosch Municipality.
   Copyright (C) 2026 Hennie Kotze

   This program is free software: you can redistribute it and/or modify
   it under the terms of the GNU Affero General Public License as
   published by the Free Software Foundation, either version 3 of the
   License, or (at your option) any later version.

   This program is distributed in the hope that it will be useful, but
   WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
   Affero General Public License (LICENSE in this repository, or
   <https://www.gnu.org/licenses/>) for more details.

   Source: https://github.com/javaftw/wards-map
*/

/* -----------------------------------------------------------
   PieGraph — tiny dependency-free SVG pie / donut generator.

   Produces a self-contained <svg> element from a list of slices.
   Deliberately knows nothing about demographics.json: callers pass
   plain { label, value } slices (values are summed and normalised, so
   they can be percentages, counts, whatever). Colours come from a
   shared palette so a caller can colour its own legend to match via
   PieGraph.colorAt().

   Usage:
     const svg = PieGraph.create(
       [ { label: "Coloured", value: 63.1 },
         { label: "Black African", value: 25.2 },
         { label: "White", value: 10.2 } ],
       { size: 140, holeRatio: 0.55, title: "Population groups" }
     );
     container.appendChild(svg);
   ----------------------------------------------------------- */

(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  // Distinct, reasonably colour-blind-friendly palette. The first two
  // match the app's ward/VD brand colours (CONFIG.styles in
  // ward-map.js); keep them in sync if those change.
  const DEFAULT_COLORS = [
    "#002157", // blue (ward brand)
    "#971a32", // maroon (VD brand)
    "#D7B468", // yellowish
    "#2aa9a0", // turquoise
    "#7a4fa3", // purple
    "#d98a29", // orange
    "#c24a6b", // rose
    "#5b6bbf", // periwinkle
    "#6b8e4e", // green
    "#c4c4c4", // light gray (last; also used for "Other" remainders)
  ];

  const DEFAULTS = {
    size: 140,
    colors: DEFAULT_COLORS,
    holeRatio: 0, // 0 = solid pie; 0<r<1 = donut with that inner ratio
    strokeColor: "#ffffff",
    strokeWidth: 1,
    startAngle: 0, // degrees, 0 = 12 o'clock, sweeps clockwise
    title: null, // optional accessible <title> for the whole chart
  };

  function opt(options, key) {
    return options && options[key] != null ? options[key] : DEFAULTS[key];
  }

  function colorAt(index, options) {
    const colors = opt(options, "colors");
    return colors[index % colors.length];
  }

  function el(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  // Point on a circle at `angleDeg`, measured clockwise from 12 o'clock.
  function pointOnCircle(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function fmt(n) {
    // Trim to a sensible precision so path strings stay small.
    return Math.round(n * 1000) / 1000;
  }

  // Path for one wedge (holeRatio 0) or annular sector (holeRatio > 0)
  // spanning [a0, a1] degrees clockwise.
  function slicePath(cx, cy, rOuter, rInner, a0, a1) {
    const largeArc = a1 - a0 > 180 ? 1 : 0;
    const o0 = pointOnCircle(cx, cy, rOuter, a0);
    const o1 = pointOnCircle(cx, cy, rOuter, a1);

    if (rInner <= 0) {
      return (
        "M " + fmt(cx) + " " + fmt(cy) +
        " L " + fmt(o0.x) + " " + fmt(o0.y) +
        " A " + fmt(rOuter) + " " + fmt(rOuter) + " 0 " + largeArc + " 1 " + fmt(o1.x) + " " + fmt(o1.y) +
        " Z"
      );
    }

    const i1 = pointOnCircle(cx, cy, rInner, a1);
    const i0 = pointOnCircle(cx, cy, rInner, a0);
    return (
      "M " + fmt(o0.x) + " " + fmt(o0.y) +
      " A " + fmt(rOuter) + " " + fmt(rOuter) + " 0 " + largeArc + " 1 " + fmt(o1.x) + " " + fmt(o1.y) +
      " L " + fmt(i1.x) + " " + fmt(i1.y) +
      " A " + fmt(rInner) + " " + fmt(rInner) + " 0 " + largeArc + " 0 " + fmt(i0.x) + " " + fmt(i0.y) +
      " Z"
    );
  }

  // Full ring / disc, used when a single slice makes up the whole pie
  // (a 360° arc collapses to a point, so it must be drawn as a circle).
  function fullCircleNode(cx, cy, rOuter, rInner, fill) {
    if (rInner <= 0) {
      return el("circle", { cx: fmt(cx), cy: fmt(cy), r: fmt(rOuter), fill: fill });
    }
    // Ring via an even-odd path: outer circle minus inner circle.
    const d =
      "M " + fmt(cx - rOuter) + " " + fmt(cy) +
      " a " + fmt(rOuter) + " " + fmt(rOuter) + " 0 1 0 " + fmt(rOuter * 2) + " 0" +
      " a " + fmt(rOuter) + " " + fmt(rOuter) + " 0 1 0 " + fmt(-rOuter * 2) + " 0 Z" +
      "M " + fmt(cx - rInner) + " " + fmt(cy) +
      " a " + fmt(rInner) + " " + fmt(rInner) + " 0 1 1 " + fmt(rInner * 2) + " 0" +
      " a " + fmt(rInner) + " " + fmt(rInner) + " 0 1 1 " + fmt(-rInner * 2) + " 0 Z";
    return el("path", { d: d, fill: fill, "fill-rule": "evenodd" });
  }

  // Normalises raw slices into drawable ones: keeps only finite,
  // positive values; attaches a colour (explicit per-slice or from the
  // palette by original index); computes each fraction of the total.
  function prepareSlices(slices, options) {
    const prepared = [];
    let total = 0;

    (slices || []).forEach(function (s, i) {
      const value = s ? Number(s.value) : NaN;
      if (!isFinite(value) || value <= 0) {
        return;
      }
      total += value;
      prepared.push({
        label: s.label != null ? String(s.label) : "",
        value: value,
        color: s.color || colorAt(i, options),
      });
    });

    prepared.forEach(function (s) {
      s.fraction = total > 0 ? s.value / total : 0;
    });

    return { slices: prepared, total: total };
  }

  // Builds the <svg> element. Returns an empty (placeholder) chart when
  // there's no positive data, so callers don't have to special-case
  // wards with missing figures (e.g. ward 23 in demographics.json).
  function create(slices, options) {
    const size = opt(options, "size");
    const stroke = opt(options, "strokeColor");
    const strokeWidth = opt(options, "strokeWidth");
    const holeRatio = Math.max(0, Math.min(0.95, opt(options, "holeRatio")));
    const title = opt(options, "title");

    const cx = size / 2;
    const cy = size / 2;
    const rOuter = size / 2 - strokeWidth; // keep the stroke inside the box
    const rInner = rOuter * holeRatio;

    const svg = el("svg", {
      class: "piegraph",
      viewBox: "0 0 " + size + " " + size,
      width: size,
      height: size,
      role: "img",
    });

    if (title) {
      const t = el("title", null);
      t.textContent = title;
      svg.appendChild(t);
      svg.setAttribute("aria-label", title);
    }

    const prepared = prepareSlices(slices, options);

    if (prepared.slices.length === 0) {
      // No data — faint placeholder ring/disc so the slot isn't blank.
      svg.appendChild(fullCircleNode(cx, cy, rOuter, rInner, "#e3e6ea"));
      return svg;
    }

    if (prepared.slices.length === 1) {
      const only = prepared.slices[0];
      const node = fullCircleNode(cx, cy, rOuter, rInner, only.color);
      node.setAttribute("stroke", stroke);
      node.setAttribute("stroke-width", strokeWidth);
      appendSliceTitle(node, only);
      svg.appendChild(node);
      return svg;
    }

    let angle = opt(options, "startAngle");
    prepared.slices.forEach(function (s) {
      const sweep = s.fraction * 360;
      const path = el("path", {
        d: slicePath(cx, cy, rOuter, rInner, angle, angle + sweep),
        fill: s.color,
        stroke: stroke,
        "stroke-width": strokeWidth,
        "stroke-linejoin": "round",
      });
      appendSliceTitle(path, s);
      svg.appendChild(path);
      angle += sweep;
    });

    return svg;
  }

  // Native browser tooltip on hover: "Label — 63.1%".
  function appendSliceTitle(node, slice) {
    const t = el("title", null);
    const pct = Math.round(slice.fraction * 1000) / 10;
    t.textContent = slice.label ? slice.label + " — " + pct + "%" : pct + "%";
    node.appendChild(t);
  }

  window.PieGraph = {
    create: create,
    colorAt: colorAt,
    DEFAULT_COLORS: DEFAULT_COLORS,
  };
})();
