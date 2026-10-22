const screenImage = document.querySelector("#screen");
const shade = document.querySelector("#shade");
const selection = document.querySelector("#selection");
const label = document.querySelector("#size");
let start = null;
window.region.image().then((data) => {
  screenImage.src = data;
});
function bounds(event) {
  const x = Math.max(0, Math.min(innerWidth, event.clientX));
  const y = Math.max(0, Math.min(innerHeight, event.clientY));
  return {
    x: Math.min(start.x, x),
    y: Math.min(start.y, y),
    width: Math.abs(x - start.x),
    height: Math.abs(y - start.y),
  };
}
document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  start = { x: event.clientX, y: event.clientY };
  document.body.setPointerCapture(event.pointerId);
});
document.addEventListener("pointermove", (event) => {
  if (!start) return;
  const r = bounds(event);
  Object.assign(selection.style, {
    display: "block",
    left: r.x + "px",
    top: r.y + "px",
    width: r.width + "px",
    height: r.height + "px",
  });
  shade.style.clipPath = `polygon(0% 0%,0% 100%,${r.x}px 100%,${r.x}px ${r.y}px,${r.x + r.width}px ${r.y}px,${r.x + r.width}px ${r.y + r.height}px,${r.x}px ${r.y + r.height}px,${r.x}px 100%,100% 100%,100% 0%)`;
  label.textContent = `${Math.round((r.width * screenImage.naturalWidth) / innerWidth)} × ${Math.round((r.height * screenImage.naturalHeight) / innerHeight)}`;
  Object.assign(label.style, {
    display: "block",
    left: Math.min(r.x + r.width + 12, innerWidth - 120) + "px",
    top: Math.min(r.y + r.height + 12, innerHeight - 40) + "px",
  });
});
document.addEventListener("pointerup", (event) => {
  if (!start) return;
  const r = bounds(event);
  start = null;
  if (r.width < 2 || r.height < 2) {
    selection.style.display = "none";
    shade.style.clipPath = "none";
    return;
  }
  window.region.finish({
    x: r.x / innerWidth,
    y: r.y / innerHeight,
    width: r.width / innerWidth,
    height: r.height / innerHeight,
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.region.cancel();
});
