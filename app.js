(function () {
  "use strict";
  const C = window.CanopyCore;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = C.escape, fmt = C.format;
  const bundled = window.CANOPY_RECORDS;
  const storageKey = "canopy-reviews-v2-" + (bundled[0]?.source_sha256?.slice(0, 14) ?? "imported");
  const tabs = { explore:"Screening map", gallery:"Photo collection", compare:"Compare results",
    analyse:"Analyse a photo", review:"Review queue", data:"Playground data", methods:"Method & guide" };
  const features = [
    ["tree_pct","Trees","--tree"], ["other_vegetation_pct","Other vegetation","--veg"],
    ["sky_pct","Visible sky","--sky"], ["buildings_pct","Buildings","--building"], ["other_pct","Other features","--other"],
  ];
  const views = { original:"Photo", mask:"AI mask", overlay:"Overlay", swipe:"Swipe" };
  const assetTypes = ["original","mask","overlay"];
  const labels = { review:"Manual review", candidate:"Inspection candidate", clear:"Not flagged" };
  let rows = loadBundled(), selected = rows[0]?.playground_id;
  let cutoff = C.thresholds(rows), comparison = rows.slice(0, 2).map(row => row.playground_id);
  let view = "original", viewerId, sortField = "playground_id", ascending = true;
  let usingBundle = true, toastTimer;
  const map = new CanopyMap($("#map"), id => openRecord(id, false));

  function stored(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }

  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  function loadBundled() {
    const reviews = window.CANOPY_PORTABLE ? {} : stored(storageKey, {});
    return structuredClone(bundled).map(row => {
      const review = reviews[row.playground_id];
      if (review && typeof review === "object") {
        for (const key of C.reviewFields) if (Object.hasOwn(review, key)) row[key] = review[key];
      }
      return row;
    });
  }

  const find = id => rows.find(row => row.playground_id === id);
  const candidate = row => C.candidate(row, cutoff);
  const status = row => C.status(row, cutoff);
  const label = row => status(row) === "clear" ?
    (C.browserAnalysis(row) ? "New photo" : !cutoff ? "Insufficient sample" : labels.clear) : labels[status(row)];
  const badge = row => '<span class="pill ' + status(row) + '">' + label(row) + '</span>';
  const value = (row, key) => key === "other_pct" ? C.other(row) : row[key];
  const size = (row, key) => Math.max(0, Math.min(100, value(row, key)));

  function toast(message) {
    const node = $("#toast");
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 4200);
  }

  function image(row, kind = "original", lazy = false, className = "") {
    const src = row[kind + "_image"];
    if (!/^(assets\/evidence\/PG_\d{2}_(original|mask|overlay)\.(jpg|png|webp)|data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+)$/.test(src ?? "")) return "";
    return `<img class="${className}" src="${src}" alt="${esc(views[kind] + " of " + row.location)}" ${lazy ? 'loading="lazy"' : ''} decoding="async">`;
  }

  function imagePanel(row, kind, lazy = false) {
    if (kind === "swipe") {
      const photo = image(row), mask = image(row, "mask", false, "swipe-mask");
      if (!photo || !mask) return '<p class="empty">Attach an original and a mask for swipe view.</p>';
      return `<div class="swipe">${photo}${mask}
        <span class="swipe-label photo" aria-hidden="true">Photo</span>
        <span class="swipe-label mask" aria-hidden="true">AI mask</span>
        <span class="swipe-handle" aria-hidden="true"></span>
        <input data-swipe type="range" min="0" max="100" value="50" aria-label="Photo and AI mask split">
      </div>`;
    }
    return image(row, kind, lazy) || '<p class="empty">No ' + views[kind].toLowerCase() + ' attached.</p>';
  }

  function viewButtons(attribute, current) {
    return Object.entries(views).map(([kind, name]) =>
      `<button data-${attribute}="${kind}" aria-pressed="${current === kind}">${name}</button>`).join("");
  }

  function metrics(row) {
    return features.map(([key, name, color]) => `<div class="metric"><span>${name}</span>
      <span class="track" aria-hidden="true"><i style="width:${size(row,key)}%;background:var(${color})"></i></span>
      <strong>${fmt(value(row,key))}%</strong></div>`).join("");
  }

  function showTab(id, updateURL = true, scroll = true) {
    if (!Object.hasOwn(tabs, id)) return;
    $$(".tab").forEach(node => { node.hidden = node.id !== id; });
    $$("[data-tab]").forEach(button => {
      if (button.dataset.tab === id) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    $("#breadcrumb").textContent = tabs[id];
    if (updateURL) setHash(id);
    if (id === "explore") map.render();
    if (scroll) window.scrollTo({ top:0, behavior:"instant" });
  }

  function setHash(value) {
    if (location.hash === "#" + value) return;
    try { history.pushState(null, "", "#" + value); } catch { location.hash = value; }
  }

  function openRecord(id, scroll = true, updateURL = true) {
    const row = find(id);
    if (!row) return;
    if (!mapRows().includes(row)) {
      $("#search").value = "";
      $("#statusFilter").value = "all";
    }
    selected = id;
    view = "original";
    showTab("explore", false, false);
    renderDetail();
    renderMap();
    if (scroll && C.mapped(row)) map.focus(row);
    if (updateURL) setHash("playground=" + encodeURIComponent(id));
    if (scroll || matchMedia("(max-width: 700px)").matches) {
      requestAnimationFrame(() => $(scroll ? "#mapWorkspace" : "#detail").scrollIntoView({ block:"start" }));
    }
  }

  function route() {
    const hash = location.hash.slice(1);
    const id = new URLSearchParams(hash).get("playground");
    if (id && find(id)) return openRecord(id, true, false);
    if (hash !== "main") showTab(Object.hasOwn(tabs, hash) ? hash : "explore", false, false);
  }

  function renderStats() {
    const sample = rows.filter(row => !C.browserAnalysis(row));
    const uploads = rows.length - sample.length;
    const demo = sample.length && sample.every(row => row.demo);
    const b2 = sample.length && sample.every(row => row.model_name === "nvidia/segformer-b2-finetuned-ade-512-512");
    const located = rows.filter(C.mapped).length;
    const review = rows.filter(row => status(row) === "review").length;
    const inspected = rows.filter(row => status(row) === "candidate").length;
    const description = demo ? "Fictional example records." :
      b2 ? "Precomputed SegFormer B2 results from the group’s collection." : "Imported records. See each record for model provenance.";
    $("#datasetBanner").innerHTML = `<span><strong>${demo ? "Demonstration dataset" : "Photograph analysis"}</strong> · ${sample.length ? description : ""}${uploads ? ` ${uploads} added in the browser.` : ""}</span>
      <span class="dataset-status">${review ? "Human review pending" : "Review status recorded"}</span>`;
    $("#stats").innerHTML = [
      [uploads ? "Photo records" : "Playgrounds",rows.length,"One image per record"],
      ["Photo candidates",rows.filter(candidate).length,inspected+" ready for site inspection","candidate"],
      ["Manual review",review,"Detection, photo or location checks","review"],
      ["Mapped",located+" / "+rows.length,(rows.length-located)+" missing coordinates"],
    ].map(([name,count,note,filter]) => {
      const content = `<span class="stat-label">${name}</span><strong class="number">${count}</strong><small>${note}</small>`;
      return filter ?
        `<button class="stat stat-action" data-screen-filter="${filter}" aria-pressed="false">${content}</button>` :
        `<div class="stat">${content}</div>`;
    }).join("");
    $("#ruleSummary").textContent = $("#methodThresholds").textContent = cutoff ?
      `Photo screening rule: tree pixels ≤ ${fmt(cutoff.tree)}% and sky pixels ≥ ${fmt(cutoff.sky)}%. Thresholds are relative to this dataset.` :
      "Load at least five records to apply the relative screening rule.";
    const hero = rows.find(row => row.playground_id === "PG_29" && image(row)) ?? rows.find(row => image(row));
    $(".hero-evidence").hidden = !hero;
    if (hero) {
      $("#heroImage").innerHTML = image(hero) + '<span class="hero-id">' + esc(hero.playground_id) + '</span>';
      $("#heroCaption").textContent = hero.location;
      $("#heroInspect").dataset.record = hero.playground_id;
    }
  }

  function mapRows() {
    const filter = $("#statusFilter").value, search = $("#search").value;
    return rows.filter(row => C.search(row, search) && (filter === "all" ||
      (filter === "candidate" ? candidate(row) : status(row) === (filter === "inspection" ? "candidate" : filter))));
  }

  function renderMap() {
    const matches = mapRows();
    const located = matches.filter(C.mapped);
    const reviewMode = $("#mapColour").value === "review";
    $("#mapcount").textContent = located.length + " mapped · " + matches.length + " matching";
    const filter = $("#statusFilter").value;
    $$("[data-screen-filter]").forEach(button =>
      button.setAttribute("aria-pressed", String(button.dataset.screenFilter === filter)));
    const empty = $("#mapEmpty");
    empty.hidden = Boolean(located.length);
    empty.innerHTML = located.length ? "" : matches.length ?
      `<span>These results have no coordinates.</span><button data-show-matches>View matching records</button>` :
      `<span>No playgrounds match this search.</span><button data-screen-filter="all">Clear filters</button>`;
    $("#mapLegend").innerHTML = reviewMode ?
      '<span><i class="dot" style="background:#684882"></i>Manual review</span><span><i class="dot" style="background:#a16414"></i>Inspection candidate</span><span><i class="dot"></i>Not flagged</span>' :
      '<span><i class="dot" style="background:#a16414"></i>Relative photo candidate</span><span><i class="dot"></i>Other photo</span><span><i class="dot" style="background:#bf9bd6"></i>Violet outline: review needed</span>';
    if (matches.some(C.browserAnalysis)) $("#mapLegend").insertAdjacentHTML("beforeend", '<span><i class="dot upload-dot"></i>Browser analysis</span>');
    $("#mapResultList").innerHTML = matches.length ? matches.map(row =>
      `<button data-record="${esc(row.playground_id)}">${esc(row.playground_id+" · "+row.location)}${C.mapped(row) ? "" : " · Unlocated"}</button>`).join("") :
      '<p class="empty">No matching playgrounds.</p>';
    map.setPoints(located.map(row => ({ row, selected:row.playground_id === selected, reviewMode,
      candidate:reviewMode ? status(row) === "candidate" : candidate(row), needsReview:status(row) === "review" })));
  }

  function options(values, current) {
    return values.map(item => `<option${item === current ? " selected" : ""}>${item}</option>`).join("");
  }

  function renderDetail(keepOpen = false) {
    const row = find(selected), panel = $("#detail");
    if (!row) { panel.innerHTML = '<p class="empty">Select a playground.</p>'; return; }
    const issues = C.issues(row);
    const coordinates = C.mapped(row) ? `${row.latitude.toFixed(6)}, ${row.longitude.toFixed(6)} · ${esc(row.location_confidence)}` :
      "Unlocated · coordinate pair unavailable";
    const fields = [
      ["detection_review","Detection"], ["photo_quality","Photo quality"], ["location_confidence","Location confidence"],
    ].map(([key, title]) => `<label>${title}<select name="${key}">${options(C.reviewOptions[key],row[key])}</select></label>`).join("");
    const newPhoto = C.browserAnalysis(row);
    const mapLink = newPhoto && C.mapped(row) ? `<a class="button" href="https://www.openstreetmap.org/?mlat=${row.latitude}&amp;mlon=${row.longitude}#map=17/${row.latitude}/${row.longitude}" target="_blank" rel="noopener">Open location on OpenStreetMap</a>` : "";
    const provenance = [row.filename,row.photo_source,row.photo_quality_note,row.scope_note,row.model_name,
      row.analysis_width ? row.analysis_width+" × "+row.analysis_height+" analysis pixels" : ""].filter(Boolean).map(esc).join("<br>");
    panel.innerHTML = `<div class="detail-meta"><span>${newPhoto ? "Browser analysis" : "Selected playground"} · ${esc(row.playground_id)}</span>${badge(row)}</div>
      <h2>${esc(row.location)}</h2><p class="coords">${coordinates}</p>
      <div class="segments" aria-label="Image view">${viewButtons("view",view)}</div>
      <div class="imagebox">${imagePanel(row,view)}</div>
      <div class="image-tools"><button data-enlarge>Enlarge</button><button data-compare-selected>Compare</button>${newPhoto ? "" : "<button data-share>Copy link</button>"}</div>
      <div class="metrics">${metrics(row)}</div>
      <p class="source-line">Total vegetation ${fmt(row.vegetation_pct)}% · Shelter visible: ${esc(row.shelter_visible || "Unclear")}</p>
      <div class="callout"><strong>${issues.length ? "Verify this evidence" : label(row)}</strong>
      ${issues.length ? issues.map(esc).join(" · ") : "Use a site visit to establish actual shade conditions."}</div>${mapLink}
      <details class="review-form"${keepOpen ? " open" : ""}><summary>Human review &amp; attachments</summary>
        <form id="reviewForm" class="form-grid">${fields}
          <label>Latitude<input name="latitude" type="number" step="any" value="${esc(row.latitude)}"></label>
          <label>Longitude<input name="longitude" type="number" step="any" value="${esc(row.longitude)}"></label>
          <label>Shelter visible<select name="shelter_visible">${options(["Unclear","Yes","No"],row.shelter_visible || "Unclear")}</select></label>
          <label>Review notes<textarea name="review_notes" rows="3" maxlength="3000">${esc(row.review_notes)}</textarea></label>
          <button class="primary" type="submit">Save review</button>
        </form>
        ${assetTypes.map(kind => `<label class="attach-group">Attach ${views[kind].toLowerCase()}
          <input data-attach="${kind}" type="file" accept="image/jpeg,image/png,image/webp"></label>`).join("")}
      </details>
      <details class="review-form"><summary>Photo and model provenance</summary><p class="source-line">${provenance}</p></details>`;
  }

  function saveReview(form) {
    const row = find(selected), fields = Object.fromEntries(new FormData(form));
    const lat = fields.latitude.trim(), lon = fields.longitude.trim();
    if (Boolean(lat) !== Boolean(lon)) return toast("Enter both coordinates or leave both blank.");
    fields.latitude = lat ? Number(lat) : null;
    fields.longitude = lon ? Number(lon) : null;
    if (lat && !C.mapped({ ...row, ...fields })) return toast(C.browserAnalysis(row) ? "Enter a valid latitude and longitude." : "Coordinates must fall within Singapore.");
    Object.assign(row, fields);
    const saved = usingBundle && !C.browserAnalysis(row) && !window.CANOPY_PORTABLE &&
      store(storageKey,{ ...stored(storageKey,{}),[row.playground_id]:fields });
    refresh(true);
    if (C.mapped(row)) map.focus(row);
    toast(saved ? "Review saved on this device." : "Review updated. Save portable HTML to keep it.");
  }

  function openViewer(id, kind) {
    const row = find(id);
    if (!row) return;
    viewerId = id;
    $("#viewerTitle").textContent = id + " · " + row.location;
    $("#viewerMeta").textContent = [row.filename,row.model_name].filter(Boolean).join(" · ");
    $("#viewerTabs").innerHTML = viewButtons("large-view",kind);
    $("#viewerImage").innerHTML = imagePanel(row,kind);
    $("#viewerLegend").innerHTML = features.map(([key,name,color]) =>
      `<span><i class="dot" style="background:var(${color})"></i>${name} ${fmt(value(row,key))}%</span>`).join("");
    if (!$("#imageViewer").open) $("#imageViewer").showModal();
  }

  function renderGallery() {
    const matches = rows.filter(row => C.search(row,$("#gallerySearch").value));
    $("#galleryCount").textContent = matches.length + (matches.length === 1 ? " photograph" : " photographs");
    $("#galleryGrid").innerHTML = matches.length ? matches.map(row => `<button class="photocard" data-record="${esc(row.playground_id)}">
      <div class="imagebox">${imagePanel(row,"original",true)}</div>
      <div class="card-body"><span class="card-id">${esc(row.playground_id)}</span><h3>${esc(row.location)}</h3>
      <p class="mini-metrics">Trees ${fmt(row.tree_pct)}% · Sky ${fmt(row.sky_pct)}%</p>${badge(row)}</div></button>`).join("") :
      '<p class="empty">No photographs match your search.</p>';
  }

  function updateComparison(id, add) {
    if (!find(id)) return;
    if (add && !comparison.includes(id)) {
      if (comparison.length >= 4) toast("Remove a playground before adding another.");
      else comparison.push(id);
    }
    if (!add) comparison = comparison.filter(item => item !== id);
    renderComparison(); renderTable();
  }

  function renderComparison() {
    const picker = $("#comparePicker"), choice = picker.value;
    picker.innerHTML = rows.map(row => `<option value="${esc(row.playground_id)}">${esc(row.playground_id+" · "+row.location)}</option>`).join("");
    if (find(choice)) picker.value = choice;
    $("#compareCount").textContent = comparison.length || "";
    $("#comparison").innerHTML = comparison.length ? comparison.map(id => {
      const row = find(id);
      return `<article class="comparecard"><div class="compare-head"><span class="card-id">${esc(id)}</span>
        <button class="icon-button" data-remove="${esc(id)}" aria-label="Remove ${esc(id)}">×</button></div>
        <h3>${esc(row.location)}</h3>${badge(row)}
        <div class="imagebox">${imagePanel(row,"original",true)}</div>
        <div class="imagebox">${imagePanel(row,"mask",true)}</div><div class="metrics">${metrics(row)}</div>
        <p class="source-line">${esc(row.review_notes || "No reviewer notes")}</p><button data-record="${esc(id)}">Open record ↗</button></article>`;
    }).join("") : '<p class="empty">Choose playgrounds above or select rows in the register.</p>';
  }

  function renderScatter() {
    const x = v => 64+v*6.1, y = v => 270-v*2.2;
    const grid = [0,25,50,75,100].map(v => `<path class="chart-grid" d="M64 ${y(v)}H674 M${x(v)} 50V270"/>
      <text x="${x(v)}" y="287" text-anchor="middle">${v}%</text><text x="52" y="${y(v)+4}" text-anchor="end">${v}%</text>`).join("");
    const zone = cutoff ? `<rect class="chart-zone" x="64" y="50" width="${cutoff.tree*6.1}" height="${y(cutoff.sky)-50}"/>
      <path class="chart-threshold" d="M${x(cutoff.tree)} 50V270 M64 ${y(cutoff.sky)}H674"/>` : "";
    const dots = rows.map(row => {
      const fill = { review:"#8664a2",candidate:"#a16414",clear:"#347758" }[status(row)];
      const description = row.playground_id+" · tree "+fmt(row.tree_pct)+"%, sky "+fmt(row.sky_pct)+"%";
      return `<circle tabindex="0" role="button" data-record="${esc(row.playground_id)}" aria-label="Inspect ${esc(description)}"
        cx="${x(row.tree_pct)}" cy="${y(row.sky_pct)}" r="6" fill="${fill}"><title>${esc(description)}</title></circle>`;
    }).join("");
    $("#scatter").innerHTML = `<svg class="chart" viewBox="0 0 720 320" aria-label="Tree versus visible sky percentage">${zone}${grid}${dots}
      <text x="367" y="314" text-anchor="middle">Tree pixels</text>
      <text x="17" y="161" transform="rotate(-90 17 161)" text-anchor="middle">Visible sky</text></svg>
      <p class="scope">The shaded area marks photo candidates. Point colours show review status.</p>`;
  }

  function queueRows() {
    const filter = $("#queueFilter").value;
    return rows.filter(row => status(row) !== "clear" && (filter === "all" ||
      (filter === "candidate" && candidate(row)) || (filter === "unlocated" && !C.mapped(row)) ||
      (filter === "inspection" && status(row) === "candidate")))
      .sort((a,b) => Number(status(b) === "review") - Number(status(a) === "review"));
  }

  function renderQueue() {
    const matches = queueRows();
    $("#queue").innerHTML = matches.length ? matches.map(row => `<div class="queue-item"><div><div class="actions">
      <strong>${esc(row.playground_id+" · "+row.location)}</strong>${badge(row)}</div>
      <p>${C.issues(row).map(esc).join(" · ") || "Review complete. Verify on site."}
      ${row.review_notes ? "<br>"+esc(row.review_notes) : ""}</p></div>
      <button data-record="${esc(row.playground_id)}">Open ↗</button></div>`).join("") :
      '<p class="empty">No records match this queue filter.</p>';
  }

  function renderTable() {
    const matches = rows.filter(row => C.search(row,$("#dataSearch").value)).sort((a,b) => {
      const x = a[sortField], y = b[sortField];
      return (typeof x === "number" ? x-y : String(x).localeCompare(String(y),undefined,{numeric:true})) * (ascending ? 1 : -1);
    });
    $("#dataCount").textContent = matches.length+(matches.length === 1 ? " record" : " records");
    $$("[data-sort]").forEach(button => button.closest("th").setAttribute("aria-sort", button.dataset.sort === sortField ?
      (ascending ? "ascending" : "descending") : "none"));
    $("#tablebody").innerHTML = matches.length ? matches.map(row => {
      const mix = features.map(([key,,color]) => `<i style="width:${size(row,key)}%;background:var(${color})"></i>`).join("");
      return `<tr><td><button data-record="${esc(row.playground_id)}">${esc(row.playground_id)} ↗</button></td><td>${esc(row.location)}</td>
        <td>${fmt(row.tree_pct)}%</td><td>${fmt(row.sky_pct)}%</td><td><span class="stack">${mix}</span></td><td>${badge(row)}</td>
        <td>${C.mapped(row) ? esc(row.location_confidence) : "Unlocated"}</td><td><input type="checkbox" data-compare="${esc(row.playground_id)}"
        aria-label="Compare ${esc(row.playground_id)}"${comparison.includes(row.playground_id) ? " checked" : ""}></td></tr>`;
    }).join("") : '<tr><td colspan="8" class="empty">No matching records.</td></tr>';
  }

  function refresh(keepOpen = false) {
    cutoff = C.thresholds(rows);
    if (!find(selected)) selected = rows[0]?.playground_id;
    comparison = comparison.filter(find);
    renderStats(); renderDetail(keepOpen); renderMap(); renderGallery();
    renderComparison(); renderQueue(); renderTable(); renderScatter();
  }

  function download(name, body, mime) {
    const url = URL.createObjectURL(new Blob([body],{ type:mime }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url),2000);
  }

  function downloadCSV(name, records, template = false) {
    download(name,C.toCSV(records,cutoff,template),"text/csv;charset=utf-8");
  }

  function template() {
    downloadCSV("playground_results_template.csv",[{ playground_id:"SG001", location:"Playground name",
      tree_pct:20, other_vegetation_pct:10, vegetation_pct:30, sky_pct:40, buildings_pct:20 }],true);
  }

  function dataURL(blob) {
    return new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error("Could not read image."));
      reader.readAsDataURL(blob);
    });
  }

  async function attach(file, row, kind) {
    if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 20*1024**2) {
      throw Error("Use JPG, PNG or WebP under 20 MB.");
    }
    const src = await dataURL(file), preview = new Image();
    preview.src = src;
    await preview.decode();
    row[kind+"_image"] = src;
  }

  async function bulkAttach(files) {
    const feedback = $("#bulkFeedback");
    if (files.length > 160) { feedback.textContent = "Select up to 160 images at once."; return; }
    let attached = 0;
    const skipped = [];
    for (const file of files) {
      const match = C.matchAttachment(file.name,rows);
      if (!match) { skipped.push(file.name); continue; }
      try { await attach(file,match.row,match.view); attached++; }
      catch { skipped.push(file.name); }
    }
    refresh();
    feedback.textContent = "Attached "+attached+" image(s)."+(skipped.length ? " Check "+skipped.slice(0,5).join(", ")+(skipped.length>5 ? "…" : "") : "");
  }

  function resetFilters() {
    ["#search","#gallerySearch","#dataSearch"].forEach(id => { $(id).value = ""; });
    $("#statusFilter").value = $("#queueFilter").value = "all";
  }

  function setPhotoPreview(file) {
    const preview = $("#analysisPreview");
    if (preview.src.startsWith("blob:")) URL.revokeObjectURL(preview.src);
    preview.hidden = !file;
    if (file) preview.src = URL.createObjectURL(file);
    else preview.removeAttribute("src");
  }

  async function analysePhoto(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const statusLine = $("#analysisStatus");
    if (form.dataset.busy === "true") return;
    const fields = new FormData(form);
    const file = fields.get("photo");
    const latitude = Number(fields.get("latitude"));
    const longitude = Number(fields.get("longitude"));
    form.dataset.busy = "true";
    form.querySelectorAll("input,button").forEach(input => { input.disabled = true; });
    statusLine.removeAttribute("data-error");
    statusLine.textContent = "Preparing photo…";
    try {
      const result = await CanopyPhotoAnalysis.analyse(file, phase => {
        statusLine.textContent = phase === "loading" ? "Loading SegFormer B2. The first download can take a moment…" : "Analysing the photograph…";
      });
      let number = rows.filter(C.browserAnalysis).length + 1;
      while (find("NEW-" + number)) number++;
      const id = "NEW-" + number;
      rows.push({
        ...result, playground_id:id, image_id:id,
        location:fields.get("location").trim() || "Uploaded playground photo " + number,
        latitude, longitude, filename:file.name, photo_source:"User-selected image, processed in browser",
        data_origin:C.browserOrigin, scope_note:"Added during this session. Separate from the study sample.",
        shelter_visible:"Unclear", detection_review:"Unreviewed", photo_quality:"Unreviewed", location_confidence:"Unverified",
      });
      refresh();
      openRecord(id);
      form.reset();
      setPhotoPreview(null);
      statusLine.textContent = "";
      toast("Photo analysed and added to the map.");
    } catch (error) {
      statusLine.dataset.error = "";
      statusLine.textContent = error.message;
    } finally {
      delete form.dataset.busy;
      form.querySelectorAll("input,button").forEach(input => { input.disabled = false; });
    }
  }

  async function importCSV() {
    const file = $("#csvFile").files[0], feedback = $("#importFeedback");
    if (!file) { feedback.textContent = "Choose a CSV first."; return; }
    try {
      if (file.size > 5*1024**2) throw Error("Use a CSV under 5 MB.");
      const imported = C.parseCSV(await file.text());
      rows = imported;
      usingBundle = false;
      selected = rows[0].playground_id; comparison = []; view = "original";
      resetFilters(); refresh(); showTab("explore"); map.fit();
      feedback.textContent = "Loaded "+rows.length+" records. Attach matching images below.";
    } catch (error) { feedback.textContent = "Import failed: "+error.message; }
  }

  function restore() {
    if (usingBundle && !window.CANOPY_PORTABLE) {
      if (!window.confirm("Restore the shared dataset and clear reviews saved on this device?")) return;
      try { localStorage.removeItem(storageKey); } catch {}
    }
    rows = loadBundled();
    usingBundle = true;
    selected = rows[0]?.playground_id; comparison = rows.slice(0,2).map(row => row.playground_id); view = "original";
    resetFilters(); refresh(); showTab("explore"); map.fit();
    toast("Supplied dataset restored.");
  }

  async function checkedFetch(url) {
    const response = await fetch(url);
    if (!response.ok) throw Error("Could not read "+url);
    return response;
  }

  async function saveHTML() {
    const button = $("#saveHtml"), original = button.textContent;
    button.disabled = true; button.textContent = "Preparing HTML…";
    try {
      const portable = structuredClone(rows);
      for (const row of portable) await Promise.all(assetTypes.map(async kind => {
        const key = kind+"_image", src = row[key];
        if (src?.startsWith("assets/evidence/")) row[key] = await dataURL(await (await checkedFetch(src)).blob());
      }));
      const clone = document.documentElement.cloneNode(true);
      const head = clone.querySelector("head"), body = clone.querySelector("body");
      const scripts = [...document.querySelectorAll("head script, body > script[data-role]")];
      if (!scripts.length) throw Error("No application scripts were found.");
      const contents = await Promise.all(scripts.map(async script => {
        if (script.dataset.role === "records" || script.getAttribute("src") === "data/records.js") {
          const json = JSON.stringify(portable).replaceAll("<","\\u003c");
          return ["records","window.CANOPY_PORTABLE = true; window.CANOPY_RECORDS = "+json+";"];
        }
        return ["code",script.hasAttribute("src") ? await (await checkedFetch(script.src)).text() : script.textContent];
      }));
      clone.querySelectorAll("script").forEach(script => script.remove());
      for (const [role,source] of contents) {
        const script = document.createElement("script");
        script.dataset.role = role;
        script.textContent = source;
        body.append(script);
      }
      const css = document.querySelector('link[rel="stylesheet"]');
      if (css) {
        let style = await (await checkedFetch(css.href)).text();
        for (const font of ["geist","geist-mono"]) {
          const src = "assets/"+font+".woff2";
          style = style.replace(src,await dataURL(await (await checkedFetch(src)).blob()));
        }
        const sheet = document.createElement("style"); sheet.textContent = style;
        head.querySelector('link[rel="stylesheet"]').replaceWith(sheet);
      }
      const dynamic = ["heroImage","stats","mapGeometry","markers","mapResultList","detail","galleryGrid",
        "comparison","queue","tablebody","scatter","viewerImage","viewerTabs","viewerLegend","comparePicker","analysisStatus"];
      dynamic.forEach(id => clone.querySelector("#"+id)?.replaceChildren());
      clone.querySelectorAll("#basemap text").forEach(node => node.remove());
      clone.querySelectorAll("dialog[open],details[open]").forEach(node => node.removeAttribute("open"));
      clone.querySelector("#explore").removeAttribute("hidden");
      clone.querySelector("#analyse").setAttribute("hidden","");
      clone.querySelector("#photoForm").removeAttribute("data-busy");
      clone.querySelectorAll("#photoForm [disabled]").forEach(input => input.removeAttribute("disabled"));
      clone.querySelector("#analysisPreview").removeAttribute("src");
      clone.querySelector("#analysisPreview").setAttribute("hidden","");
      clone.querySelector("#toast").setAttribute("hidden","");
      clone.querySelector("#saveHtml").removeAttribute("disabled");
      clone.querySelector("#saveHtml").textContent = original;
      download("Canopy_Playground_Screening.html","<!doctype html>\n"+clone.outerHTML,"text/html;charset=utf-8");
      toast("Portable HTML saved with the map, images and reviews.");
    } catch {
      toast("Could not save portable HTML. Open the hosted site or the supplied offline HTML.");
    } finally {
      button.disabled = false; button.textContent = original;
    }
  }

  async function share() {
    if (!usingBundle || window.CANOPY_PORTABLE || location.protocol === "file:") {
      return toast("Use Save portable HTML to share this copy and its records.");
    }
    const url = new URL(location.href);
    url.hash = "playground="+encodeURIComponent(selected);
    try { await navigator.clipboard.writeText(url.href); toast("Playground link copied."); }
    catch { window.prompt("Copy this playground link",url.href); }
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("#themeToggle").setAttribute("aria-pressed",String(theme==="dark"));
    $("#themeToggle").textContent = theme === "dark" ? "Light mode" : "Dark mode";
  }

  document.addEventListener("click",event => {
    const button = event.target.closest("button,[role=button]");
    if (!button) {
      if (!event.target.closest("#utility")) $("#utility").open = false;
      return;
    }
    const data = button.dataset;
    if (data.close) $("#"+data.close).close();
    if (data.tab || data.go) showTab(data.tab || data.go);
    if (data.record) openRecord(data.record);
    if (data.screenFilter) {
      const filter = $("#statusFilter");
      filter.value = filter.value === data.screenFilter ? "all" : data.screenFilter;
      $("#search").value = "";
      renderMap();
      map.fit();
      $("#mapWorkspace").scrollIntoView({ block:"start" });
      filter.focus({ preventScroll:true });
    }
    if (Object.hasOwn(data,"showMatches")) {
      const results = $(".map-results");
      results.open = true;
      $("#mapResultList button")?.focus();
    }
    if (data.remove) updateComparison(data.remove,false);
    if (data.view) {
      view = data.view;
      renderDetail(Boolean($("#detail .review-form[open]")));
      $("#detail [data-view='"+view+"']")?.focus({ preventScroll:true });
    }
    if (data.largeView) {
      openViewer(viewerId,data.largeView);
      $("#viewerTabs [data-large-view='"+data.largeView+"']")?.focus({ preventScroll:true });
    }
    if (Object.hasOwn(data,"enlarge")) openViewer(selected,view);
    if (Object.hasOwn(data,"compareSelected")) { updateComparison(selected,true); showTab("compare"); }
    if (Object.hasOwn(data,"share")) share();
    if (data.sort) {
      ascending = sortField === data.sort ? !ascending : true;
      sortField = data.sort;
      renderTable();
    }
  });

  document.addEventListener("keydown",event => {
    const point = event.target.closest("circle[data-record]");
    if (point && ["Enter"," "].includes(event.key)) {
      event.preventDefault(); openRecord(point.dataset.record);
    }
  });

  document.addEventListener("input",event => {
    if (event.target.matches("[data-swipe]")) {
      event.target.closest(".swipe").style.setProperty("--reveal",event.target.value+"%");
    }
  });

  document.addEventListener("submit",event => {
    if (event.target.id === "reviewForm") { event.preventDefault(); saveReview(event.target); }
  });

  document.addEventListener("change",async event => {
    const node = event.target;
    if (node.dataset.compare) updateComparison(node.dataset.compare,node.checked);
    if (node.dataset.attach && node.files[0]) {
      try {
        await attach(node.files[0],find(selected),node.dataset.attach);
        refresh(true);
        toast("Image attached. Save portable HTML to keep it.");
      } catch (error) { toast(error.message); }
    }
  });

  $("#themeToggle").onclick = () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(theme); store("canopy-theme",theme);
  };
  $("#exploreButton").onclick = () => $("#mapWorkspace").scrollIntoView({ block:"start" });
  $("#photoForm").onsubmit = analysePhoto;
  $("#analysisFile").onchange = event => setPhotoPreview(event.target.files[0]);
  for (const [id,dialog] of [["helpButton","helpDialog"],["importButton","importDialog"]]) {
    $("#"+id).onclick = () => { $("#utility").open = false; $("#"+dialog).showModal(); };
  }
  $("#saveHtml").onclick = () => { $("#utility").open = false; saveHTML(); };
  $("#exportButton").onclick = () => { $("#utility").open = false; downloadCSV("playground_results.csv",rows); };
  $("#exportQueue").onclick = () => downloadCSV("playground_review_queue.csv",queueRows());
  $("#templateButton").onclick = $("#templateButton2").onclick = template;
  $("#manifestDownload").onclick = () => download("analysis_manifest.json",JSON.stringify({
    scope:"Image-pixel proportions. Shelter visibility and review are human observations.",
    records:rows.map(({original_image,mask_image,overlay_image,...record}) => record),
  },null,2),"application/json");
  $("#bulkImages").onchange = event => bulkAttach([...event.target.files]);
  $("#loadCSV").onclick = importCSV;
  $("#resetDataset").onclick = restore;
  $("#addCompare").onclick = () => updateComparison($("#comparePicker").value,true);
  $("#clearCompare").onclick = () => { comparison = []; renderComparison(); renderTable(); };
  $("#gallerySearch").oninput = renderGallery;
  $("#dataSearch").oninput = renderTable;
  $("#queueFilter").onchange = renderQueue;
  $("#search").oninput = () => { renderMap(); map.fit(); };
  $("#statusFilter").onchange = () => { renderMap(); map.fit(); };
  $("#mapColour").onchange = renderMap;
  window.addEventListener("hashchange",route);

  setTheme(stored("canopy-theme",matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  refresh(); map.fit(); route();
})();

