import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Square,
  Circle,
  Pencil,
  Type,
  Highlighter,
  ScanLine,
  ListOrdered,
  Crop,
  MousePointer2,
  Undo2,
  Redo2,
  Minus,
  Plus,
  Copy,
  Save,
  Check,
  Download,
  Maximize2,
  Trash2,
  X,
} from "lucide-react";
import type { Capture, Settings } from "./types";
import { api, fromDataUrl, loadImage, imageDetails } from "./api";
import { Modal, Spinner } from "./components";
import {
  initialDoc,
  backgrounds,
  markColors,
  normalizedRect,
  renderImage,
  bounds,
  moveMark,
  type Tool,
  type Mark,
  type EditorDoc,
  type Point,
} from "./editorEngine";

const tools: { id: Tool; label: string; key: string; icon: typeof Square }[] = [
  { id: "select", label: "Select", key: "V", icon: MousePointer2 },
  { id: "arrow", label: "Arrow", key: "A", icon: ArrowUpRight },
  { id: "rect", label: "Rectangle", key: "R", icon: Square },
  { id: "ellipse", label: "Ellipse", key: "E", icon: Circle },
  { id: "pen", label: "Draw", key: "P", icon: Pencil },
  { id: "text", label: "Text", key: "T", icon: Type },
  { id: "highlight", label: "Highlight", key: "H", icon: Highlighter },
  { id: "redact", label: "Redact", key: "B", icon: ScanLine },
  { id: "step", label: "Numbered step", key: "N", icon: ListOrdered },
  { id: "crop", label: "Crop", key: "C", icon: Crop },
];
function readDraft(id: string): EditorDoc {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(`frame-draft-${id}`) || "null",
    );
    if (
      saved &&
      Array.isArray(saved.marks) &&
      backgrounds.some((b) => b.id === saved.background) &&
      Number.isFinite(saved.padding) &&
      Number.isFinite(saved.radius)
    )
      return saved;
  } catch {}
  return structuredClone(initialDoc);
}
export default function Editor({
  capture,
  onBack,
  onSaved,
  onError,
  settings,
}: {
  capture: Capture;
  onBack: () => void;
  onSaved: (c: Capture) => void;
  onError: (s: string) => void;
  settings: Settings;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [doc, setDoc] = useState<EditorDoc>(() => readDraft(capture.id));
  const docRef = useRef(doc);
  docRef.current = doc;
  const [past, setPast] = useState<EditorDoc[]>(() =>
      JSON.stringify(doc) !== JSON.stringify(initialDoc)
        ? [structuredClone(initialDoc)]
        : [],
    ),
    [future, setFuture] = useState<EditorDoc[]>([]);
  const [tool, setTool] = useState<Tool>("arrow"),
    [color, setColor] = useState("blue"),
    [size, setSize] = useState(5);
  const [draft, setDraft] = useState<Mark | null>(null),
    [cropDraft, setCropDraft] = useState<ReturnType<
      typeof normalizedRect
    > | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [textPoint, setTextPoint] = useState<Point | null>(null),
    [text, setText] = useState("");
  const [zoom, setZoom] = useState(1),
    [fit, setFit] = useState(1),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [exitPrompt, setExitPrompt] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ start: Point; mark?: Mark; moving?: Mark } | null>(
    null,
  );
  const commit = (next: EditorDoc) => {
    setPast((p) => [...p.slice(-49), docRef.current]);
    setFuture([]);
    setDoc(next);
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [docRef.current, ...f]);
    setDoc(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setSelected(null);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, docRef.current]);
    setDoc(future[0]);
    setFuture((f) => f.slice(1));
    setSelected(null);
  };
  const dirty = past.length > 0;
  useEffect(() => {
    try {
      sessionStorage.setItem(`frame-draft-${capture.id}`, JSON.stringify(doc));
    } catch {}
  }, [doc, capture.id]);
  useEffect(() => {
    let active = true;
    api
      .read(capture.id)
      .then(async ({ data, mime }) => {
        const img = await loadImage(`data:${mime};base64,${data}`);
        if (active) setImage(img);
      })
      .catch((e) => onError(e.message));
    return () => {
      active = false;
    };
  }, [capture.id]);
  useLayoutEffect(() => {
    if (!image || !canvas.current) return;
    renderImage(
      canvas.current,
      image,
      draft && doc.marks.some((m) => m.id === draft.id)
        ? { ...doc, marks: doc.marks.filter((m) => m.id !== draft.id) }
        : doc,
      draft,
    );
    const ctx = canvas.current.getContext("2d")!;
    const crop = doc.crop || { x: 0, y: 0 };
    const current = doc.marks.find((m) => m.id === selected);
    const rect = cropDraft || (current ? bounds(current) : null);
    if (rect) {
      ctx.save();
      ctx.strokeStyle = getComputedStyle(
        document.documentElement,
      ).getPropertyValue("--color-accent");
      ctx.lineWidth = 2 / Math.max(fit * zoom, 0.1);
      ctx.setLineDash([7 / (fit * zoom), 5 / (fit * zoom)]);
      ctx.strokeRect(
        rect.x - crop.x + doc.padding - 4,
        rect.y - crop.y + doc.padding - 4,
        rect.width + 8,
        rect.height + 8,
      );
      ctx.restore();
    }
    const measure = () => {
      if (viewport.current && canvas.current)
        setFit(
          Math.min(
            (viewport.current.clientWidth - 56) / canvas.current.width,
            (viewport.current.clientHeight - 56) / canvas.current.height,
            1,
          ),
        );
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [image, doc, draft, selected, cropDraft, fit, zoom]);
  useEffect(() => {
    const callback = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).matches("input,textarea,select") ||
        document.querySelector("dialog[open]")
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        commit({
          ...docRef.current,
          marks: docRef.current.marks.filter((m) => m.id !== selected),
        });
        setSelected(null);
      }
      if (e.key === "Escape") {
        setSelected(null);
        setTool("select");
      }
      if (!e.metaKey && !e.ctrlKey) {
        const found = tools.find(
          (t) => t.key.toLowerCase() === e.key.toLowerCase(),
        );
        if (found) setTool(found.id);
      }
    };
    window.addEventListener("keydown", callback);
    return () => window.removeEventListener("keydown", callback);
  });
  function point(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const c = canvas.current!,
      r = c.getBoundingClientRect(),
      crop = docRef.current.crop || { x: 0, y: 0 };
    return {
      x: Math.max(
        crop.x,
        Math.min(
          crop.x + c.width - docRef.current.padding * 2,
          ((event.clientX - r.left) * c.width) / r.width -
            docRef.current.padding +
            crop.x,
        ),
      ),
      y: Math.max(
        crop.y,
        Math.min(
          crop.y + c.height - docRef.current.padding * 2,
          ((event.clientY - r.top) * c.height) / r.height -
            docRef.current.padding +
            crop.y,
        ),
      ),
    };
  }
  function down(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!image || event.button !== 0) return;
    const p = point(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "text") {
      setTextPoint(p);
      setText("");
      return;
    }
    if (tool === "select") {
      const mark = [...doc.marks].reverse().find((m) => {
        const b = bounds(m);
        return (
          p.x >= b.x - 15 &&
          p.x <= b.x + b.width + 15 &&
          p.y >= b.y - 15 &&
          p.y <= b.y + b.height + 15
        );
      });
      setSelected(mark?.id || null);
      gesture.current = mark ? { start: p, moving: mark } : null;
      return;
    }
    setSelected(null);
    if (tool === "crop") {
      gesture.current = { start: p };
      setCropDraft({ x: p.x, y: p.y, width: 0, height: 0 });
      return;
    }
    const mark: Mark = {
      id: crypto.randomUUID(),
      type: tool,
      x: p.x,
      y: p.y,
      x2: p.x,
      y2: p.y,
      color,
      size,
      points: tool === "pen" ? [p] : undefined,
      number: doc.marks.filter((m) => m.type === "step").length + 1,
    };
    if (tool === "step") {
      commit({ ...doc, marks: [...doc.marks, mark] });
      return;
    }
    gesture.current = { start: p, mark };
    setDraft(mark);
  }
  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    const g = gesture.current;
    if (!g) return;
    const p = point(event);
    if (g.moving) {
      setDraft(moveMark(g.moving, p.x - g.start.x, p.y - g.start.y));
      return;
    }
    if (tool === "crop") {
      setCropDraft(normalizedRect(g.start, p));
      return;
    }
    if (g.mark) {
      g.mark = {
        ...g.mark,
        x2: p.x,
        y2: p.y,
        points: g.mark.points ? [...g.mark.points, p] : undefined,
      };
      setDraft(g.mark);
    }
  }
  function up(event: React.PointerEvent<HTMLCanvasElement>) {
    const g = gesture.current;
    if (!g) return;
    const p = point(event);
    gesture.current = null;
    if (g.moving) {
      const moved = moveMark(g.moving, p.x - g.start.x, p.y - g.start.y);
      if (Math.abs(p.x - g.start.x) + Math.abs(p.y - g.start.y) > 1)
        commit({
          ...doc,
          marks: doc.marks.map((m) => (m.id === moved.id ? moved : m)),
        });
      setDraft(null);
      return;
    }
    if (tool === "crop") {
      const r = normalizedRect(g.start, p);
      if (r.width >= 4 && r.height >= 4)
        commit({
          ...doc,
          crop: {
            x: Math.round(r.x),
            y: Math.round(r.y),
            width: Math.round(r.width),
            height: Math.round(r.height),
          },
        });
      setCropDraft(null);
      setTool("select");
      return;
    }
    if (g.mark && Math.abs(p.x - g.start.x) + Math.abs(p.y - g.start.y) > 2)
      commit({
        ...doc,
        marks: [...doc.marks, { ...g.mark, x2: p.x, y2: p.y }],
      });
    setDraft(null);
  }
  async function rendered() {
    if (!image) throw new Error("Image is still loading.");
    const c = document.createElement("canvas");
    renderImage(c, image, docRef.current);
    return c.toDataURL("image/png");
  }
  async function save() {
    if (busy || !image) return;
    setBusy(true);
    try {
      const data = await rendered();
      const details = await imageDetails(data);
      const item = await api.save({
        name: `${capture.name.replace(/ — edited$/, "")} — edited`,
        mime: "image/png",
        bytes: fromDataUrl(data),
        ...details,
      });
      sessionStorage.removeItem(`frame-draft-${capture.id}`);
      onSaved(item);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await api.copyImage(await rendered());
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function exportEdited() {
    if (busy) return;
    setBusy(true);
    try {
      const data = await rendered();
      const item = await api.save({
        name: `${capture.name} — export`,
        mime: "image/png",
        bytes: fromDataUrl(data),
        ...(await imageDetails(data)),
      });
      await api.exportFile(item.id, settings.format);
      onSaved(item);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="editor">
      <header className="editor-head">
        <div className="editor-title">
          <button
            className="icon-button"
            aria-label="Back to library"
            onClick={() => (dirty ? setExitPrompt(true) : onBack())}
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1>{capture.name}</h1>
            <p>
              {dirty ? "Unsaved edits · original preserved" : "Original image"}{" "}
              <span>·</span> {capture.width} × {capture.height}
            </p>
          </div>
        </div>
        <div className="editor-actions">
          <button className="button" onClick={copy} disabled={!image}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
          <button
            className="button"
            onClick={exportEdited}
            disabled={busy || !image}
          >
            <Download size={16} />
            <span>Export</span>
          </button>
          <button
            className="button primary"
            onClick={save}
            disabled={busy || !image}
          >
            {busy ? (
              <Spinner label="Saving…" />
            ) : (
              <>
                <Save size={16} />
                <span>Save copy</span>
              </>
            )}
          </button>
        </div>
      </header>
      <div className="editor-body">
        <div className="editor-center">
          <div
            className="annotation-bar"
            role="toolbar"
            aria-label="Annotation tools"
          >
            {tools.map((t) => (
              <button
                key={t.id}
                className={`tool-button ${tool === t.id ? "selected" : ""}`}
                title={`${t.label} (${t.key})`}
                aria-label={t.label}
                aria-pressed={tool === t.id}
                onClick={() => {
                  setTool(t.id);
                  setSelected(null);
                }}
              >
                <t.icon size={19} />
              </button>
            ))}
            <span className="toolbar-divider" />
            <button
              className="tool-button"
              title="Undo (Ctrl/⌘ Z)"
              aria-label="Undo"
              onClick={undo}
              disabled={!past.length}
            >
              <Undo2 size={18} />
            </button>
            <button
              className="tool-button"
              title="Redo (Ctrl/⌘ Shift Z)"
              aria-label="Redo"
              onClick={redo}
              disabled={!future.length}
            >
              <Redo2 size={18} />
            </button>
          </div>
          <div className={`canvas-viewport tool-${tool}`} ref={viewport}>
            {image ? (
              <canvas
                aria-label="Image annotation canvas"
                ref={canvas}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={() => {
                  gesture.current = null;
                  setDraft(null);
                  setCropDraft(null);
                }}
                style={{
                  width:
                    ((doc.crop?.width || image.width) + doc.padding * 2) *
                    fit *
                    zoom,
                  height:
                    ((doc.crop?.height || image.height) + doc.padding * 2) *
                    fit *
                    zoom,
                }}
              />
            ) : (
              <Spinner label="Opening image…" />
            )}
          </div>
          <footer className="canvas-footer">
            <span>
              {tool === "crop"
                ? "Drag over the image to crop"
                : tool === "select"
                  ? "Select an annotation to move or delete it"
                  : tool === "redact"
                    ? "Draw an opaque block over sensitive details"
                    : tool === "text"
                      ? "Click anywhere to add text"
                      : `Drag to add ${tool === "pen" ? "a drawing" : `an ${tool}`}`}
            </span>
            <div>
              <button
                className="icon-button"
                aria-label="Zoom out"
                onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
              >
                <Minus size={15} />
              </button>
              <button
                className="zoom-label"
                onClick={() => setZoom(1)}
                title="Fit to view"
              >
                {Math.round(fit * zoom * 100)}%
              </button>
              <button
                className="icon-button"
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
              >
                <Plus size={15} />
              </button>
              <button
                className="icon-button"
                aria-label="Fit image"
                onClick={() => setZoom(1)}
              >
                <Maximize2 size={15} />
              </button>
            </div>
          </footer>
        </div>
        <aside className="inspector">
          <div className="inspector-title">
            Appearance <span>Image</span>
          </div>
          <section>
            <h3>Annotation</h3>
            <div className="color-row">
              {markColors.map((c) => (
                <button
                  key={c.id}
                  className={`color-swatch ${color === c.id ? "chosen" : ""}`}
                  style={{ background: `var(${c.token})` }}
                  title={c.label}
                  aria-label={`${c.label} annotation`}
                  aria-pressed={color === c.id}
                  onClick={() => setColor(c.id)}
                />
              ))}
            </div>
            <label className="slider-label" htmlFor="stroke-size">
              Stroke size <span>{size} px</span>
            </label>
            <input
              id="stroke-size"
              type="range"
              min="2"
              max="16"
              value={size}
              onChange={(e) => setSize(+e.target.value)}
            />
            {selected && (
              <button
                className="button danger full"
                onClick={() => {
                  commit({
                    ...doc,
                    marks: doc.marks.filter((m) => m.id !== selected),
                  });
                  setSelected(null);
                }}
              >
                <Trash2 size={15} />
                Delete annotation
              </button>
            )}
          </section>
          <section>
            <h3>Background</h3>
            <div className="background-grid">
              {backgrounds.map((b) => (
                <button
                  key={b.id}
                  className={`background-choice ${doc.background === b.id ? "chosen" : ""}`}
                  title={b.label}
                  aria-label={`${b.label} background`}
                  aria-pressed={doc.background === b.id}
                  onClick={() =>
                    commit({
                      ...doc,
                      background: b.id,
                      padding: b.id === "none" ? 0 : doc.padding || 64,
                    })
                  }
                >
                  <span
                    className={b.id === "none" ? "checker" : ""}
                    style={{
                      background:
                        b.id === "none" ? undefined : `var(${b.token})`,
                    }}
                  />
                  {b.label}
                </button>
              ))}
            </div>
            <label className="slider-label" htmlFor="padding">
              Padding <span>{doc.padding} px</span>
            </label>
            <input
              id="padding"
              type="range"
              min="0"
              max="200"
              step="4"
              value={doc.padding}
              onChange={(e) => commit({ ...doc, padding: +e.target.value })}
            />
            <label className="slider-label" htmlFor="corners">
              Corner radius <span>{doc.radius} px</span>
            </label>
            <input
              id="corners"
              type="range"
              min="0"
              max="80"
              step="2"
              value={doc.radius}
              onChange={(e) => commit({ ...doc, radius: +e.target.value })}
            />
            <label className="toggle-row">
              <span>Drop shadow</span>
              <input
                type="checkbox"
                role="switch"
                checked={doc.shadow}
                onChange={(e) => commit({ ...doc, shadow: e.target.checked })}
              />
            </label>
          </section>
          <section>
            <h3>Image</h3>
            <div className="spec-row">
              <span>Dimensions</span>
              <span>
                {Math.round(
                  (doc.crop?.width || capture.width) + doc.padding * 2,
                )}{" "}
                ×{" "}
                {Math.round(
                  (doc.crop?.height || capture.height) + doc.padding * 2,
                )}
              </span>
            </div>
            <div className="spec-row">
              <span>Format</span>
              <span>PNG</span>
            </div>
            {doc.crop && (
              <button
                className="button full"
                onClick={() => commit({ ...doc, crop: null })}
              >
                <X size={14} />
                Reset crop
              </button>
            )}
          </section>
          <div className="inspector-note">
            <Save size={16} />
            <p>
              Save an edited copy.
              <br />
              Your original stays untouched.
            </p>
          </div>
        </aside>
      </div>
      {textPoint && (
        <Modal title="Add text" onClose={() => setTextPoint(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) {
                const mark: Mark = {
                  id: crypto.randomUUID(),
                  type: "text",
                  ...textPoint,
                  x2: textPoint.x,
                  y2: textPoint.y,
                  color,
                  size,
                  text: text.trim(),
                };
                commit({ ...doc, marks: [...doc.marks, mark] });
                setTextPoint(null);
              }
            }}
          >
            <label className="field-label" htmlFor="annotation-text">
              Annotation text
            </label>
            <input
              className="text-input"
              id="annotation-text"
              autoFocus
              maxLength={240}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Look at this detail"
            />
            <div className="modal-actions">
              <button
                className="button"
                type="button"
                onClick={() => setTextPoint(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={!text.trim()}>
                Add text
              </button>
            </div>
          </form>
        </Modal>
      )}
      {exitPrompt && (
        <Modal title="Keep your edits?" onClose={() => setExitPrompt(false)}>
          <p className="modal-description">
            Save an edited copy before returning to your library.
          </p>
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => {
                sessionStorage.removeItem(`frame-draft-${capture.id}`);
                onBack();
              }}
            >
              Discard edits
            </button>
            <button
              className="button primary"
              onClick={() => {
                setExitPrompt(false);
                void save();
              }}
            >
              Save copy
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
