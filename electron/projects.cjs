const TYPES = new Set([
  "arrow",
  "rect",
  "ellipse",
  "pen",
  "text",
  "highlight",
  "redact",
  "step",
]);
const FONTS = new Set([
  "Inter",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "monospace",
]);
function validDocument(doc) {
  if (!doc || !Array.isArray(doc.marks) || doc.marks.length > 10000)
    throw new Error("Invalid annotation document.");
  if (
    !["none", "paper", "mist", "sand", "sage", "blue", "slate"].includes(
      doc.background,
    )
  )
    throw new Error("Invalid image background.");
  for (const key of ["padding", "radius"])
    if (!Number.isFinite(doc[key]) || doc[key] < 0 || doc[key] > 1000)
      throw new Error("Invalid image appearance.");
  const point = (v) => Number.isFinite(v) && Math.abs(v) <= 1000000;
  if (
    doc.crop &&
    !["x", "y", "width", "height"].every((k) => point(doc.crop[k]))
  )
    throw new Error("Invalid crop.");
  for (const m of doc.marks) {
    if (
      !m ||
      !TYPES.has(m.type) ||
      typeof m.id !== "string" ||
      m.id.length > 80 ||
      !["x", "y", "x2", "y2", "size"].every((k) => point(m[k])) ||
      m.size < 1 ||
      m.size > 500
    )
      throw new Error("Invalid annotation.");
    if (
      !["blue", "red", "yellow", "dark", "light"].includes(m.color) &&
      !/^#[0-9a-f]{6}$/i.test(m.color)
    )
      throw new Error("Invalid annotation color.");
    if (
      m.text !== undefined &&
      (typeof m.text !== "string" || m.text.length > 2000)
    )
      throw new Error("Invalid annotation text.");
    if (m.fontFamily !== undefined && !FONTS.has(m.fontFamily))
      throw new Error("Invalid font.");
    if (
      m.fontSize !== undefined &&
      (!Number.isFinite(m.fontSize) || m.fontSize < 8 || m.fontSize > 500)
    )
      throw new Error("Invalid font size.");
    if (
      m.fontStyle !== undefined &&
      !["regular", "bold", "italic", "bold-italic"].includes(m.fontStyle)
    )
      throw new Error("Invalid font style.");
    if (
      m.number !== undefined &&
      (!Number.isInteger(m.number) || m.number < 0 || m.number > 99999)
    )
      throw new Error("Invalid step number.");
    if (
      m.points &&
      (!Array.isArray(m.points) ||
        m.points.length > 100000 ||
        m.points.some((p) => !point(p.x) || !point(p.y)))
    )
      throw new Error("Invalid drawing.");
  }
  const text = JSON.stringify(doc);
  if (text.length > 4000000)
    throw new Error("Annotation document is too large.");
  return JSON.parse(text);
}
module.exports = { validDocument };
