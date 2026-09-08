/* Direct forecast exploration. Hover only previews; click or keyboard commits.
   Rendering and motion never alter the underlying model values. */
const previous = new WeakMap();

export function wireDecisionPlot(host, { points, selected, width, height, left, right, top, bottom, domain, onSelect }) {
  const svg = host.querySelector("svg");
  const inspector = document.getElementById("curveInspector");
  const cursor = host.querySelector(".curve-selected-point");
  const line = host.querySelector(".curve-selected-line");
  const preview = host.querySelector(".curve-preview");
  if (!svg || !points.length) return;
  const active = points[selected];
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const before = previous.get(host);
  if (!reduced && before?.domain === domain && before.width === width && before.index !== active.index) {
    const timing = { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" };
    cursor?.animate?.([{ transform: `translate(${before.x - active.x}px, ${before.y - active.y}px)` }, { transform: "translate(0,0)" }], timing);
    line?.animate?.([{ transform: `translateX(${before.x - active.x}px)` }, { transform: "translateX(0)" }], timing);
  }
  previous.set(host, { ...active, domain, width });

  host.setAttribute("role", "slider");
  host.tabIndex = 0;
  host.setAttribute("aria-label", "Forecast start time");
  host.setAttribute("aria-orientation", "horizontal");
  host.setAttribute("aria-valuemin", String(points[0].index));
  host.setAttribute("aria-valuemax", String(points.at(-1).index));
  host.setAttribute("aria-valuenow", String(active.index));
  host.setAttribute("aria-valuetext", `${active.label}, ${active.detail}`);
  host.setAttribute("aria-describedby", "curveHelp");

  function describe(point, isPreview) {
    if (!inspector) return;
    inspector.classList.toggle("previewing", isPreview);
    inspector.querySelector(".curve-inspector-label").textContent = `${isPreview ? "PREVIEW" : "SELECTED"} / ${point.label}`;
    inspector.querySelector(".curve-inspector-detail").textContent = point.detail;
  }
  describe(active, false);

  // Account for SVG letterboxing: the hit test follows the actual plot, not
  // the containing div's padding or the space above/below its viewBox.
  function hit(event) {
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / width, rect.height / height);
    if (!(scale > 0)) return null;
    const px = (event.clientX - rect.left - (rect.width - width * scale) / 2) / scale;
    const py = (event.clientY - rect.top - (rect.height - height * scale) / 2) / scale;
    if (px < left || px > width - right || py < top || py > height - bottom) return null;
    return Math.max(0, Math.min(points.length - 1, Math.round((px - left) / (width - left - right) * (points.length - 1))));
  }
  function clear() {
    if (preview) preview.style.display = "none";
    describe(active, false);
  }
  host.onpointermove = event => {
    if (event.pointerType === "touch") return; // preserve ordinary page scrolling
    const index = hit(event);
    if (index == null) { clear(); return; }
    const point = points[index];
    if (preview) {
      preview.style.display = "";
      preview.querySelector("line").setAttribute("x1", point.x);
      preview.querySelector("line").setAttribute("x2", point.x);
      preview.querySelector("circle").setAttribute("cx", point.x);
      preview.querySelector("circle").setAttribute("cy", point.y);
    }
    describe(point, true);
  };
  host.onpointerleave = clear;
  host.onblur = clear;
  host.onclick = event => {
    const index = hit(event);
    if (index != null) onSelect(points[index].index);
  };
  host.onkeydown = event => {
    const moves = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -3, PageUp: 3 };
    if (!(event.key in moves) && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1
      : Math.max(0, Math.min(points.length - 1, selected + moves[event.key]));
    onSelect(points[index].index);
  };
}
