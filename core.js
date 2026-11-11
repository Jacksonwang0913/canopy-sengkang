(function (root) {
  "use strict";

  const featureFields = ["tree_pct", "other_vegetation_pct", "vegetation_pct", "sky_pct", "buildings_pct"];
  const required = ["playground_id", "location", ...featureFields];
  const reviewOptions = {
    detection_review: ["Unreviewed", "Checked", "Unreliable"],
    photo_quality: ["Unreviewed", "Suitable", "Unclear", "Outdated"],
    location_confidence: ["Unverified", "Exact point", "Approximate block"],
  };
  const reviewFields = [...Object.keys(reviewOptions), "latitude", "longitude", "review_notes", "shelter_visible"];
  const csvFields = [
    "playground_id", "location", "latitude", "longitude", ...featureFields,
    "shelter_visible", "photo_source", "photo_quality_note", "screening_note",
    ...Object.keys(reviewOptions), "review_notes", "data_origin", "filename", "image_id",
    "model_name", "model_revision", "analysis_timestamp", "analysis_width", "analysis_height",
    "analysis_seconds", "source_sha256", "scope_note",
  ];

  const escape = value => String(value ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const format = value => Number(value).toFixed(1).replace(/\.0$/, "");
  const mapped = ({ latitude, longitude }) => Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= 1.15 && latitude <= 1.48 && longitude >= 103.58 && longitude <= 104.10;
  const search = (record, term) =>
    [record.playground_id, record.location, record.filename, record.image_id]
      .some(value => String(value ?? "").toLowerCase().includes(term.trim().toLowerCase()));
  const other = r => Math.max(0, 100 - r.tree_pct - r.other_vegetation_pct - r.sky_pct - r.buildings_pct);

  function quantile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * fraction;
    const low = Math.floor(index);
    return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
  }

  function thresholds(rows) {
    if (rows.length < 5) return null;
    return { tree: quantile(rows.map(row => row.tree_pct), .25), sky: quantile(rows.map(row => row.sky_pct), .75) };
  }

  function candidate(row, cutoff) {
    return Boolean(cutoff && row.tree_pct <= cutoff.tree && row.sky_pct >= cutoff.sky);
  }

  function issues(row) {
    const concerns = [];
    if (row.detection_review !== "Checked") concerns.push(row.detection_review === "Unreliable" ? "AI detection marked unreliable" : "AI detection unchecked");
    if (row.photo_quality !== "Suitable") concerns.push("Photo quality: " + (row.photo_quality || "Unreviewed"));
    if (!mapped(row)) concerns.push("Missing valid Singapore coordinates");
    else if (row.location_confidence !== "Exact point") concerns.push("Location: " + (row.location_confidence || "Unverified"));
    return concerns;
  }

  function status(row, cutoff) {
    if (issues(row).length) return "review";
    return candidate(row, cutoff) ? "candidate" : "clear";
  }

  function csvRows(text) {
    const rows = [];
    let row = [], field = "", quoted = false, closedQuote = false;
    text = text.replace(/^\uFEFF/, "");
    const finishField = () => { row.push(field); field = ""; closedQuote = false; };
    const finishRow = () => { finishField(); if (row.some(cell => cell.trim())) rows.push(row); row = []; };
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') { field += '"'; i++; }
        else if (quoted) { quoted = false; closedQuote = true; }
        else if (!field && !closedQuote) quoted = true;
        else throw Error("Unexpected quote in CSV.");
      } else if (char === "," && !quoted) finishField();
      else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && text[i + 1] === "\n") i++;
        finishRow();
      } else if (!closedQuote || quoted) field += char;
      else if (char !== " " && char !== "\t") throw Error("Unexpected text after a closing quote.");
    }
    if (quoted) throw Error("Unclosed quote in CSV.");
    finishRow();
    return rows;
  }

  function parseCSV(text) {
    const rows = csvRows(text);
    if (rows.length < 2) throw Error("CSV needs a header and at least one record.");
    const headers = rows.shift().map(cell => cell.trim().toLowerCase());
    if (new Set(headers).size !== headers.length) throw Error("CSV contains duplicate columns.");
    for (const field of required) if (!headers.includes(field)) throw Error("Missing column: " + field);
    if (rows.length > 500) throw Error("Import up to 500 records at a time.");
    const seen = new Set();
    return rows.map((cells, index) => {
      if (cells.length !== headers.length) throw Error("Row " + (index + 2) + " has the wrong column count.");
      const row = Object.fromEntries(headers.map((field, i) => [field, cells[i].trim()]));
      const id = row.playground_id;
      if (!id || seen.has(id)) throw Error(id ? "Duplicate playground ID: " + id : "A playground ID is missing.");
      seen.add(id);
      for (const field of featureFields) {
        const number = Number(row[field]);
        if (!row[field] || !Number.isFinite(number) || number < 0 || number > 100) {
          throw Error(id + ": " + field + " must be 0–100.");
        }
        row[field] = number;
      }
      if (row.tree_pct + row.other_vegetation_pct + row.sky_pct + row.buildings_pct > 100.2) {
        throw Error(id + ": feature percentages exceed 100%.");
      }
      if (Math.abs(row.vegetation_pct - row.tree_pct - row.other_vegetation_pct) > .21) {
        throw Error(id + ": total vegetation must equal trees plus other vegetation.");
      }
      for (const field of ["latitude", "longitude"]) {
        row[field] = row[field] && Number.isFinite(Number(row[field])) ? Number(row[field]) : null;
      }
      for (const [field, choices] of Object.entries(reviewOptions)) {
        if (!choices.includes(row[field])) row[field] = choices[0];
      }
      row.demo = row.data_origin === "Fictional demonstration";
      return row;
    });
  }

  function toCSV(rows, cutoff, template = false) {
    const cell = value => '"' + String(value ?? "").replaceAll('"', '""') + '"';
    const lines = rows.map(row => csvFields.map(field => {
      if (field === "screening_note") return cell(template ? "Pending comparison" :
        candidate(row, cutoff) ? "Relative photo-review candidate" : "Not flagged by relative rule");
      if (field === "data_origin") return cell(row.demo ? "Fictional demonstration" : "AI analysis of supplied photograph");
      return cell(row[field]);
    }).join(","));
    return [csvFields.map(cell).join(","), ...lines].join("\r\n");
  }

  function matchAttachment(fileName, rows) {
    const normalize = value => String(value ?? "").normalize("NFKC").trim().toLowerCase();
    const name = normalize(fileName);
    const exact = rows.filter(row => normalize(row.filename) === name);
    if (exact.length === 1) return { row: exact[0], view: "original" };
    const stem = name.replace(/\.[^.]+$/, "");
    const view = /(?:^|[_ -])overlay(?:$|[_ -])/.test(stem) ? "overlay" :
      /(?:^|[_ -])(?:segmentation|mask)(?:$|[_ -])/.test(stem) ? "mask" : "original";
    const prefix = stem.replace(/[_ -]+(?:(?:focus[_ -]+)?mask|segmentation|overlay|original)(?:[_ -].*)?$/, "");
    const matches = rows.filter(row => {
      if (normalize(row.filename).replace(/\.[^.]+$/, "") === prefix) return true;
      return [row.playground_id, row.image_id].filter(Boolean).some(id => {
        const escaped = normalize(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp("(^|[^a-z0-9])" + escaped + "($|[^a-z0-9])").test(stem);
      });
    });
    return matches.length === 1 ? { row: matches[0], view } : null;
  }

  root.CanopyCore = { escape, format, mapped, search, other, thresholds, candidate, issues, status,
    parseCSV, toCSV, matchAttachment, reviewOptions, reviewFields };
})(globalThis);
