export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Tool =
  | "select"
  | "arrow"
  | "rect"
  | "ellipse"
  | "pen"
  | "text"
  | "highlight"
  | "redact"
  | "step"
  | "crop";
export type Mark = {
  id: string;
  type: Exclude<Tool, "select" | "crop">;
  x: number;
  y: number;
  x2: number;
  y2: number;
  color: string;
  size: number;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontStyle?: "regular" | "bold" | "italic" | "bold-italic";
  number?: number;
  points?: Point[];
};
export type EditorDoc = {
  marks: Mark[];
  crop: Rect | null;
  background: string;
  padding: number;
  radius: number;
  shadow: boolean;
};
export const initialDoc: EditorDoc = {
  marks: [],
  crop: null,
  background: "none",
  padding: 0,
  radius: 0,
  shadow: false,
};
export const backgrounds = [
  { id: "none", label: "Transparent", token: "--color-transparent" },
  { id: "paper", label: "Paper", token: "--color-paper" },
  { id: "mist", label: "Mist", token: "--color-bg-mist" },
  { id: "sand", label: "Sand", token: "--color-bg-sand" },
  { id: "sage", label: "Sage", token: "--color-bg-sage" },
  { id: "blue", label: "Blue", token: "--color-bg-blue" },
  { id: "slate", label: "Slate", token: "--color-bg-slate" },
];
export const markColors = [
  { id: "blue", label: "Blue", token: "--color-mark-blue" },
  { id: "red", label: "Red", token: "--color-mark-red" },
  { id: "yellow", label: "Yellow", token: "--color-mark-yellow" },
  { id: "dark", label: "Charcoal", token: "--color-ink" },
  { id: "light", label: "White", token: "--color-paper" },
];
function token(name: string) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}
export const fontFamilies = [
  "Inter",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "monospace",
];
export function textFont(mark: Mark) {
  const family = fontFamilies.includes(mark.fontFamily || "")
    ? mark.fontFamily!
    : "Inter";
  const style = mark.fontStyle || "bold";
  return `${style.includes("italic") ? "italic " : ""}${style.includes("bold") ? "600" : "400"} ${mark.fontSize || mark.size * 5 + 10}px "${family}"`;
}
export function bounds(mark: Mark): Rect {
  let xs = [mark.x, mark.x2],
    ys = [mark.y, mark.y2];
  if (mark.points?.length) {
    xs = mark.points.map((p) => p.x);
    ys = mark.points.map((p) => p.y);
  }
  if (mark.type === "text") {
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = textFont(mark);
    const lines = (mark.text || " ").split("\n");
    const measuredWidth = Math.max(
      ...lines.map((line) => ctx.measureText(line).width),
    );
    const height = mark.fontSize || mark.size * 5 + 10;
    return {
      x: mark.x,
      y: mark.y - height,
      width: Math.max(1, measuredWidth),
      height: height * (1.2 + 1.25 * (lines.length - 1)),
    };
  }
  if (mark.type === "step")
    return {
      x: mark.x - mark.size * 5,
      y: mark.y - mark.size * 5,
      width: mark.size * 10,
      height: mark.size * 10,
    };
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}
export function normalizedRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
export function moveMark(mark: Mark, dx: number, dy: number): Mark {
  return {
    ...mark,
    x: mark.x + dx,
    y: mark.y + dy,
    x2: mark.x2 + dx,
    y2: mark.y2 + dy,
    points: mark.points?.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  };
}
function drawMark(ctx: CanvasRenderingContext2D, m: Mark) {
  const color = /^#[0-9a-f]{6}$/i.test(m.color)
    ? m.color
    : token(
        markColors.find((c) => c.id === m.color)?.token || "--color-mark-blue",
      );
  const r = bounds(m);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = m.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (m.type === "arrow") {
    const angle = Math.atan2(m.y2 - m.y, m.x2 - m.x);
    const head = m.size * 4 + 10;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x2, m.y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(
      m.x2 - head * Math.cos(angle - 0.45),
      m.y2 - head * Math.sin(angle - 0.45),
    );
    ctx.lineTo(m.x2, m.y2);
    ctx.lineTo(
      m.x2 - head * Math.cos(angle + 0.45),
      m.y2 - head * Math.sin(angle + 0.45),
    );
    ctx.stroke();
  } else if (m.type === "rect") {
    ctx.strokeRect(r.x, r.y, r.width, r.height);
  } else if (m.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(
      r.x + r.width / 2,
      r.y + r.height / 2,
      Math.max(0.1, r.width / 2),
      Math.max(0.1, r.height / 2),
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  } else if (m.type === "pen") {
    ctx.beginPath();
    m.points?.forEach((p, i) =>
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
    );
    ctx.stroke();
  } else if (m.type === "highlight") {
    ctx.globalAlpha = 0.35;
    ctx.fillRect(r.x, r.y, r.width, r.height);
  } else if (m.type === "redact") {
    ctx.fillStyle = token("--color-ink");
    ctx.fillRect(r.x, r.y, r.width, r.height);
  } else if (m.type === "text") {
    ctx.font = textFont(m);
    (m.text || "")
      .split("\n")
      .forEach((line, index) =>
        ctx.fillText(
          line,
          m.x,
          m.y + index * (m.fontSize || m.size * 5 + 10) * 1.25,
        ),
      );
  } else if (m.type === "step") {
    const radius = m.size * 3 + 10;
    ctx.beginPath();
    ctx.arc(m.x, m.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle =
      m.color === "light" || m.color === "yellow"
        ? token("--color-ink")
        : token("--color-paper");
    ctx.font = `600 ${Math.min(radius, ((radius * 2) / Math.max(1, String(m.number ?? 1).length)) * 1.2)}px ${token("--font-body")}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(m.number ?? 1), m.x, m.y + 1);
  }
  ctx.restore();
}
export function renderImage(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  doc: EditorDoc,
  draft?: Mark | null,
) {
  const crop = doc.crop || {
    x: 0,
    y: 0,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
  const pad = doc.padding;
  canvas.width = Math.round(crop.width + pad * 2);
  canvas.height = Math.round(crop.height + pad * 2);
  const ctx = canvas.getContext("2d")!;
  const bg = backgrounds.find((b) => b.id === doc.background)!;
  if (bg.id !== "none") {
    ctx.fillStyle = token(bg.token);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const layer = document.createElement("canvas");
  layer.width = image.naturalWidth;
  layer.height = image.naturalHeight;
  const lx = layer.getContext("2d")!;
  lx.drawImage(image, 0, 0);
  doc.marks.forEach((m) => drawMark(lx, m));
  if (draft) drawMark(lx, draft);
  if (doc.shadow) {
    ctx.save();
    ctx.shadowColor = token("--color-shadow");
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = token("--color-paper");
    ctx.beginPath();
    ctx.roundRect(pad, pad, crop.width, crop.height, doc.radius);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(
    pad,
    pad,
    crop.width,
    crop.height,
    Math.min(doc.radius, crop.width / 2, crop.height / 2),
  );
  ctx.clip();
  ctx.drawImage(
    layer,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    pad,
    pad,
    crop.width,
    crop.height,
  );
  ctx.restore();
}
