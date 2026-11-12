(function (root) {
  "use strict";

  const unit = 100000;
  const origin = { lat: 1.392, lon: 103.893 };
  const xy = (lat, lon) => [(lon - origin.lon) * unit, (origin.lat - lat) * unit];
  const svgNS = "http://www.w3.org/2000/svg";
  const worldBounds = { left: xy(0, -180)[0], right: xy(0, 180)[0], top: xy(90, 0)[1], bottom: xy(-90, 0)[1] };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const draw = (name, attrs) => {
    const el = document.createElementNS(svgNS, name);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  };
  const pathData = (coordinates, close) => coordinates.map(([lon, lat], index) => {
    const [x, y] = xy(lat, lon);
    return (index ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
  }).join("") + (close ? "Z" : "");

  class ScreeningMap {
    constructor(element, selectRecord) {
      this.el = element;
      this.geometry = element.querySelector("#mapGeometry");
      this.layer = element.querySelector("#markers");
      this.scaleLabel = element.querySelector("#mapScale");
      this.center = [0, 0];
      this.scale = .14;
      this.labels = [];
      this.points = [];
      this.pointers = new Map();
      this.selectRecord = selectRecord;
      this.hasFit = false;
      this.renderGeometry(root.CANOPY_BASEMAP ?? {});
      this.bindControls();
      new ResizeObserver(() => {
        if (!this.hasFit && this.el.clientWidth) this.fit();
        else this.render();
      }).observe(element);
    }

    renderGeometry({ features = [], areas = [], labels = [] }) {
      const lines = [];
      for (let i = -12000; i <= 12000; i += 500) {
        lines.push("M" + i + ",-12000V12000", "M-12000," + i + "H12000");
      }
      this.geometry.append(draw("path", { d: lines.join(""), class: "map-mapgrid" }));
      for (const [name, coords] of areas) {
        this.geometry.append(draw("path", { d: pathData(coords, true),
          class: name === "SENGKANG" ? "map-area" : "map-area context" }));
      }
      const types = ["park", "water", "river", "street", "road", "rail"];
      for (const type of types) {
        const d = features.filter(([key]) => key === type)
          .map(([, coords]) => pathData(coords, type === "park" || type === "water")).join("");
        if (!d) continue;
        if (type === "road" || type === "street") this.geometry.append(draw("path", { d, class: "map-" + type + "-edge" }));
        this.geometry.append(draw("path", { d, class: "map-" + type }));
      }
      const svg = this.el.querySelector("#basemap");
      for (const [label, lon, lat] of labels) {
        const text = draw("text", { class: "geo-label" + (label === "SENGKANG" ? " primary-place" : "") });
        text.textContent = label;
        svg.append(text);
        this.labels.push({ text, point: xy(lat, lon) });
      }
      this.el.querySelector("#mapAttribution").innerHTML = features.length ?
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://data.gov.sg/datasets/d_2cc750190544007400b2cfd5d7f53209/view" target="_blank" rel="noopener">URA</a>' :
        'Boundary: <a href="https://data.gov.sg/datasets/d_2cc750190544007400b2cfd5d7f53209/view" target="_blank" rel="noopener">URA</a>';
    }

    setPoints(points) {
      const hadFocus = this.layer.contains(document.activeElement) ? document.activeElement.dataset.id : null;
      this.points = points.map(({ row, selected, candidate, needsReview, reviewMode }) => {
        const button = document.createElement("button");
        button.className = "marker" + (selected ? " is-active" : "") + (candidate ? " is-candidate" : "") +
          (needsReview ? " is-review" : "") + (reviewMode ? " review-mode" : "") +
          (root.CanopyCore.browserAnalysis(row) ? " is-upload" : "");
        button.textContent = row.playground_id.replace(/^PG[_-]/i, "").slice(-4);
        button.title = row.playground_id + " · " + row.location;
        button.setAttribute("aria-label", "Open " + button.title);
        if (selected) button.setAttribute("aria-current", "true");
        button.dataset.id = row.playground_id;
        button.onclick = () => this.selectRecord(row.playground_id);
        return { button, point: xy(row.latitude, row.longitude) };
      });
      this.layer.replaceChildren(...this.points.map(({ button }) => button));
      this.render();
      this.points.find(({ button }) => button.dataset.id === hadFocus && !button.hidden)?.button.focus({ preventScroll: true });
    }

    render() {
      const w = this.el.clientWidth, h = this.el.clientHeight;
      if (!w || !h) return;
      const left = w / 2 - this.center[0] * this.scale, top = h / 2 - this.center[1] * this.scale;
      const hasLocalContext = Math.max(Math.abs(this.center[0]), Math.abs(this.center[1])) <= 2200 && this.scale >= .015;
      this.el.classList.toggle("is-coordinate-map", !hasLocalContext);
      this.el.querySelector("#mapnote").textContent = hasLocalContext ? "Sengkang basemap" : "Coordinate map · Sengkang basemap where available";
      this.scaleLabel.hidden = !hasLocalContext;
      this.geometry.setAttribute("transform", "translate(" + left + " " + top + ") scale(" + this.scale + ")");
      for (const { button, point } of this.points) {
        const x = left + point[0] * this.scale, y = top + point[1] * this.scale;
        button.hidden = x < -20 || x > w + 20 || y < -20 || y > h + 20;
        button.style.left = x + "px";
        button.style.top = y + "px";
      }
      for (const { text, point } of this.labels) {
        text.setAttribute("x", left + point[0] * this.scale);
        text.setAttribute("y", top + point[1] * this.scale);
        text.style.display = this.scale < .09 && !text.classList.contains("primary-place") ? "none" : "";
      }
      const metresPerPixel = 1.113 / this.scale;
      const nice = [100, 200, 500, 1000, 2000, 5000, 10000].find(m => m / metresPerPixel >= 52) ?? 10000;
      this.scaleLabel.style.width = Math.round(nice / metresPerPixel) + "px";
      this.scaleLabel.textContent = nice >= 1000 ? nice / 1000 + " km" : nice + " m";
    }

    fit() {
      const w = this.el.clientWidth, h = this.el.clientHeight;
      if (!w || !h) return;
      const points = this.points.map(point => point.point);
      if (!points.length) {
        this.center = [0, 0];
        this.scale = Math.min(.18, w / 4600);
      } else {
        const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
        const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
        this.center = [(left + right) / 2, (top + bottom) / 2];
        this.scale = clamp(Math.min((w - 70) / Math.max(right - left, 270),
          (h - 70) / Math.max(bottom - top, 270)), .000001, .47);
      }
      this.hasFit = true;
      this.render();
    }

    focus(row) {
      this.center = xy(row.latitude, row.longitude);
      this.render();
    }

    pan(dx, dy) {
      this.center = [clamp(this.center[0] - dx / this.scale, worldBounds.left, worldBounds.right),
        clamp(this.center[1] - dy / this.scale, worldBounds.top, worldBounds.bottom)];
      this.render();
    }

    zoom(factor, x = this.el.clientWidth / 2, y = this.el.clientHeight / 2) {
      const next = clamp(this.scale * factor, .000001, 1.15);
      const shift = 1 / this.scale - 1 / next;
      this.center = [this.center[0] + (x - this.el.clientWidth / 2) * shift,
        this.center[1] + (y - this.el.clientHeight / 2) * shift];
      this.scale = next;
      this.render();
    }

    bindControls() {
      const el = this.el;
      document.querySelector("#fitMap").onclick = () => this.fit();
      el.querySelector("#zoomIn").onclick = () => this.zoom(1.36);
      el.querySelector("#zoomOut").onclick = () => this.zoom(1 / 1.36);
      el.addEventListener("pointerdown", event => {
        if (event.target.closest("button, a") || event.button !== 0) return;
        this.pointers.set(event.pointerId, [event.clientX, event.clientY]);
        el.setPointerCapture(event.pointerId);
        el.classList.add("is-dragging");
      });
      el.addEventListener("pointermove", event => {
        const previous = this.pointers.get(event.pointerId);
        if (!previous) return;
        const next = [event.clientX, event.clientY];
        const other = [...this.pointers].find(([id]) => id !== event.pointerId)?.[1];
        this.pointers.set(event.pointerId, next);
        if (!other) this.pan(next[0] - previous[0], next[1] - previous[1]);
        else {
          const distance = Math.hypot(previous[0] - other[0], previous[1] - other[1]);
          const bounds = el.getBoundingClientRect();
          if (distance > 1) this.zoom(Math.hypot(next[0] - other[0], next[1] - other[1]) / distance,
            (next[0] + other[0]) / 2 - bounds.left, (next[1] + other[1]) / 2 - bounds.top);
        }
      });
      for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) el.addEventListener(name, event => {
        this.pointers.delete(event.pointerId);
        if (!this.pointers.size) el.classList.remove("is-dragging");
      });
      el.addEventListener("wheel", event => {
        if (!event.ctrlKey && document.activeElement !== el) return;
        event.preventDefault();
        const rect = el.getBoundingClientRect();
        this.zoom(Math.exp(-event.deltaY * .002), event.clientX - rect.left, event.clientY - rect.top);
      }, { passive: false });
      el.addEventListener("keydown", event => {
        if (event.target !== el) return;
        const offsets = { ArrowLeft: [55, 0], ArrowRight: [-55, 0], ArrowUp: [0, 55], ArrowDown: [0, -55] };
        if (offsets[event.key]) this.pan(...offsets[event.key]);
        else if (["+", "="].includes(event.key)) this.zoom(1.36);
        else if (event.key === "-") this.zoom(1 / 1.36);
        else return;
        event.preventDefault();
      });
    }
  }

  root.CanopyMap = ScreeningMap;
})(globalThis);
