import { useCallback, useEffect, useRef, useState } from "react";
import {
  Scan,
  Monitor,
  AppWindow,
  Video,
  Image as ImageIcon,
  Star,
  Settings2,
  FolderOpen,
  ArrowRight,
  Upload,
  Search,
  Grid2X2,
  List,
  MoreHorizontal,
  Copy,
  Download,
  Trash2,
  Pencil,
  Check,
  X,
  ShieldCheck,
  Keyboard,
  Command,
  CircleHelp,
  ChevronDown,
  Pause,
  Square,
  Play,
  Mic,
  Volume2,
  SlidersHorizontal,
  HardDrive,
  RefreshCw,
  PanelBottomClose,
} from "lucide-react";
import {
  api,
  desktop,
  fromDataUrl,
  imageDetails,
  loadImage,
  formatBytes,
  durationLabel,
} from "./api";
import { makeDemo } from "./demo";
import {
  FRAME_RATES,
  RECORDING_PRESETS,
  RecordingClock,
  finalizeRecording,
  recorderCandidates,
  recordingFrameRate,
  recordingMime,
  recordingPreset,
} from "./recording";
import type {
  AppInfo,
  Capture,
  Settings,
  Source,
  PermissionKind,
} from "./types";
import Editor from "./Editor";
import type { Rect } from "./editorEngine";
import { cropRecording } from "./recordingArea";
import { Modal, Spinner } from "./components";

type CaptureMode = "region" | "screen" | "window" | "record";
type View = "all" | "images" | "videos" | "favorites" | "settings" | "editor";
const defaultSettings: Settings = {
  microphone: false,
  systemAudio: false,
  countdown: 3,
  format: "png",
  fps: 15,
  recordingQuality: "compact",
  recordingFormat: "mp4",
};
function readSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem("frame-settings") || "{}");
    return {
      ...defaultSettings,
      ...saved,
      // Apply the new compact default once to preferences from the old fixed-bitrate recorder.
      fps: saved.recordingQuality ? recordingFrameRate(saved.fps) : 15,
      recordingQuality: ["compact", "balanced", "high"].includes(
        saved.recordingQuality,
      )
        ? saved.recordingQuality
        : "compact",
      recordingFormat: saved.recordingFormat === "webm" ? "webm" : "mp4",
    };
  } catch {
    return defaultSettings;
  }
}

export default function App() {
  const [items, setItems] = useState<Capture[]>([]),
    [info, setInfo] = useState<AppInfo | null>(null),
    [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("all"),
    [selected, setSelected] = useState<Capture | null>(null);
  const [settings, setSettings] = useState<Settings>(readSettings),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [layout, setLayout] = useState("grid");
  const [chooser, setChooser] = useState<CaptureMode | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<{
      message: string;
      error?: boolean;
      undo?: () => void;
    } | null>(null);
  const [rename, setRename] = useState<Capture | null>(null),
    [newName, setNewName] = useState(""),
    [video, setVideo] = useState<{ capture: Capture; url: string } | null>(
      null,
    );
  const [help, setHelp] = useState(false),
    [palette, setPalette] = useState(false),
    [commandSearch, setCommandSearch] = useState(""),
    [commandIndex, setCommandIndex] = useState(0);
  const [recordState, setRecordState] = useState<
      "idle" | "recording" | "paused" | "saving"
    >("idle"),
    [seconds, setSeconds] = useState(0),
    [countdown, setCountdown] = useState<number | null>(null);
  const recorder = useRef<MediaRecorder | null>(null),
    recordStream = useRef<MediaStream | null>(null),
    microphone = useRef<MediaStream | null>(null),
    audioContext = useRef<AudioContext | null>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    commandsRef = useRef<(command: string) => void>(() => {}),
    recordingClock = useRef(new RecordingClock()),
    importing = useRef(false);
  const cropCleanup = useRef<(() => void) | null>(null),
    cancelRecording = useRef(false);
  const [videoExportFormat, setVideoExportFormat] = useState<"mp4" | "webm">(
      "mp4",
    ),
    [exportTarget, setExportTarget] = useState<Capture | null>(null),
    [exportBusy, setExportBusy] = useState(false);
  const [shortcutBusy, setShortcutBusy] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState<PermissionKind | null>(
    null,
  );
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const notify = useCallback(
    (message: string, error = false, undo?: () => void) => {
      clearTimeout(noticeTimer.current);
      setNotice({ message, error, undo });
      if (!error)
        noticeTimer.current = setTimeout(
          () => setNotice(null),
          undo ? 10000 : 4500,
        );
    },
    [],
  );
  const error = useCallback(
    (message: string) => notify(message, true),
    [notify],
  );
  const refresh = useCallback(async () => {
    try {
      setItems(await api.list());
    } catch (e) {
      error((e as Error).message);
    }
  }, [error]);
  useEffect(() => {
    Promise.all([api.info().then(setInfo), refresh()])
      .catch((e) => error(e.message))
      .finally(() => setLoading(false));
    return () => clearTimeout(noticeTimer.current);
  }, [refresh, error]);
  useEffect(() => {
    localStorage.setItem("frame-settings", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    if (recordState !== "recording") return;
    const id = setInterval(() => {
      setSeconds(Math.floor(recordingClock.current.elapsed() / 1000));
    }, 200);
    return () => clearInterval(id);
  }, [recordState]);
  useEffect(
    () => () => {
      recordStream.current?.getTracks().forEach((t) => t.stop());
      microphone.current?.getTracks().forEach((t) => t.stop());
      if (video) URL.revokeObjectURL(video.url);
    },
    [],
  );
  const openCapture = async (capture: Capture) => {
    setVideoExportFormat(capture.mime === "video/webm" ? "webm" : "mp4");
    if (video) {
      URL.revokeObjectURL(video.url);
      setVideo(null);
    }
    if (capture.kind === "image") {
      setSelected(capture);
      setView("editor");
    } else {
      try {
        const data = await api.read(capture.id);
        const bytes = fromDataUrl(`data:${data.mime};base64,${data.data}`);
        setVideo({
          capture,
          url: URL.createObjectURL(
            new Blob([bytes as BlobPart], { type: data.mime }),
          ),
        });
      } catch (e) {
        error((e as Error).message);
      }
    }
  };
  const saved = async (capture: Capture) => {
    await refresh();
    setSelected(capture);
    setView("editor");
  };
  async function saveImage(data: string, name: string, open = true) {
    const capture = await api.save({
      name,
      mime: data.slice(5, data.indexOf(";")),
      bytes: fromDataUrl(data),
      ...(await imageDetails(data)),
    });
    await refresh();
    if (open) {
      setSelected(capture);
      setView("editor");
    }
    return capture;
  }
  async function importImage(file: File) {
    if (importing.current) return;
    importing.current = true;
    setBusy(true);
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
        throw new Error("Choose a PNG, JPEG, or WebP image.");
      if (file.size > 50 * 1024 * 1024)
        throw new Error("Choose an image smaller than 50 MB.");
      const url = URL.createObjectURL(file);
      try {
        const img = await loadImage(url);
        if (img.width * img.height > 80000000)
          throw new Error("Choose an image with fewer than 80 million pixels.");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const details = await imageDetails(url);
        const capture = await api.save({
          name: file.name.replace(/\.[^.]+$/, ""),
          mime: file.type,
          bytes,
          ...details,
        });
        await saved(capture);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      error((e as Error).message);
    } finally {
      setBusy(false);
      importing.current = false;
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (
        (e.target as HTMLElement).matches("input,textarea") ||
        document.querySelector("dialog[open]")
      )
        return;
      const file = Array.from(e.clipboardData?.files || []).find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) {
        e.preventDefault();
        void importImage(file);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });
  async function requestPermission(kind: PermissionKind) {
    setPermissionBusy(kind);
    try {
      const status = await api.requestPermission(kind);
      setInfo((current) =>
        current
          ? {
              ...current,
              screenPermission: status.screen,
              microphonePermission: status.microphone,
            }
          : current,
      );
      if (status[kind] !== "granted")
        notify(
          kind === "screen"
            ? "Allow Frame under Screen Recording in System Settings, then restart Frame."
            : "Allow Frame under Microphone in System Settings, then restart Frame.",
        );
    } catch (e) {
      error((e as Error).message);
    } finally {
      setPermissionBusy(null);
    }
  }
  async function toggleSnippingShortcut(enabled: boolean) {
    setShortcutBusy(true);
    const previous = info?.snippingShortcut;
    setInfo((current) =>
      current
        ? {
            ...current,
            snippingShortcut: { enabled, active: false, error: "" },
          }
        : current,
    );
    try {
      const status = await api.setSnippingShortcut(enabled);
      setInfo((current) =>
        current ? { ...current, snippingShortcut: status } : current,
      );
      if (status.error) error(status.error);
    } catch (e) {
      if (previous)
        setInfo((current) =>
          current ? { ...current, snippingShortcut: previous } : current,
        );
      error((e as Error).message);
    } finally {
      setShortcutBusy(false);
    }
  }
  async function screenshot(
    mode: Exclude<CaptureMode, "record">,
    sourceId = "",
  ) {
    setChooser(null);
    setBusy(true);
    try {
      let shot: { data: string; width: number; height: number } | null;
      if (desktop) shot = await api.screenshot({ mode, sourceId });
      else {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        try {
          const v = document.createElement("video");
          v.srcObject = stream;
          await v.play();
          await new Promise((r) => setTimeout(r, 180));
          const c = document.createElement("canvas");
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          c.getContext("2d")!.drawImage(v, 0, 0);
          shot = {
            data: c.toDataURL("image/png"),
            width: c.width,
            height: c.height,
          };
        } finally {
          stream.getTracks().forEach((t) => t.stop());
        }
      }
      if (shot) {
        const capture = await saveImage(
          shot.data,
          `${mode === "region" ? "Area" : mode === "window" ? "Window" : "Screenshot"} · ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
          !desktop,
        );
        if (desktop) await api.present(capture.id);
      }
      if (!desktop && shot && mode === "region")
        notify("Screen captured. Use the Crop tool to select your area.");
    } catch (e) {
      if ((e as Error).name !== "NotAllowedError") error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function action(mode: CaptureMode) {
    if (recordState !== "idle" || busy || countdown !== null) {
      notify("Finish the current capture or recording first.");
      return;
    }
    if (desktop) setChooser(mode);
    else if (mode === "record") void startRecording("");
    else void screenshot(mode);
  }
  function stopRecording() {
    cancelRecording.current = true;
    if (recorder.current && recorder.current.state !== "inactive") {
      recordingClock.current.stop();
      setRecordState("saving");
      recorder.current.stop();
    }
  }
  function cleanupRecording() {
    recordStream.current?.getTracks().forEach((t) => t.stop());
    microphone.current?.getTracks().forEach((t) => t.stop());
    void audioContext.current?.close().catch(() => {});
    recordStream.current = null;
    microphone.current = null;
    audioContext.current = null;
    cropCleanup.current?.();
    cropCleanup.current = null;
  }
  async function startRecording(sourceId: string, area = false) {
    cancelRecording.current = false;
    setChooser(null);
    setBusy(true);
    let stream: MediaStream | null = null;
    try {
      if (desktop && info?.platform === "darwin" && settings.microphone) {
        const permission = await api.requestPermission("microphone");
        setInfo((current) =>
          current
            ? { ...current, microphonePermission: permission.microphone }
            : current,
        );
        if (permission.microphone !== "granted")
          throw new Error(
            "Microphone access is required for narration. Allow Frame in System Settings → Privacy & Security → Microphone, then restart Frame or turn narration off.",
          );
      }
      let rect: Rect | undefined;
      if (desktop) {
        const prepared = await api.prepareRecording(sourceId, area);
        if (!prepared) return;
        sourceId = prepared.sourceId;
        rect = prepared.rect;
        await api.recordingState({ state: "preparing", seconds: 0 });
      }
      if (desktop)
        await api.recordingSource(
          sourceId,
          settings.systemAudio && info?.platform !== "darwin",
        );
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: {
            ideal: recordingFrameRate(settings.fps),
            max: recordingFrameRate(settings.fps),
          },
        },
        audio: settings.systemAudio && info?.platform !== "darwin",
      });
      recordStream.current = stream;
      stream.getVideoTracks()[0].onended = stopRecording;
      stream.getVideoTracks().forEach((track) => {
        track.contentHint = "detail";
      });
      if (rect) {
        const cropped = await cropRecording(stream, rect, settings.fps);
        stream = cropped.stream;
        cropCleanup.current = cropped.dispose;
        stream
          .getVideoTracks()
          .forEach((track) => (track.contentHint = "detail"));
      }
      if (settings.microphone) {
        microphone.current = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        const ac = new AudioContext();
        audioContext.current = ac;
        await ac.resume();
        const dest = ac.createMediaStreamDestination();
        ac.createMediaStreamSource(microphone.current).connect(dest);
        if (stream.getAudioTracks().length)
          ac.createMediaStreamSource(
            new MediaStream(stream.getAudioTracks()),
          ).connect(dest);
        stream = new MediaStream([
          ...stream.getVideoTracks(),
          ...dest.stream.getAudioTracks(),
        ]);
      }
      const v = document.createElement("video");
      v.srcObject = stream;
      v.muted = true;
      await v.play();
      const thumbnailCanvas = document.createElement("canvas");
      thumbnailCanvas.width = 480;
      thumbnailCanvas.height = Math.max(
        1,
        (480 * v.videoHeight) / v.videoWidth,
      );
      thumbnailCanvas
        .getContext("2d")!
        .drawImage(v, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
      const thumbnail = thumbnailCanvas.toDataURL("image/jpeg", 0.7);
      const width = v.videoWidth,
        height = v.videoHeight;
      v.pause();
      v.srcObject = null;
      for (let n = settings.countdown; n > 0; n--) {
        if (cancelRecording.current) throw new Error("Recording cancelled.");
        setCountdown(n);
        await api.recordingState({ state: "preparing", seconds: n });
        await new Promise((r) => setTimeout(r, 1000));
        if (
          !stream.getVideoTracks()[0]?.readyState ||
          stream.getVideoTracks()[0].readyState === "ended"
        )
          throw new Error("Screen sharing ended before recording started.");
      }
      setCountdown(null);
      if (cancelRecording.current) throw new Error("Recording cancelled.");
      let selectedRecorder: MediaRecorder | null = null;
      for (const options of recorderCandidates(
        {
          ...settings,
          systemAudio: settings.systemAudio && info?.platform !== "darwin",
        },
        width,
        height,
        stream.getAudioTracks().length > 0,
      )) {
        try {
          selectedRecorder = new MediaRecorder(stream, options);
          break;
        } catch {
          /* Try the next supported codec. */
        }
      }
      if (!selectedRecorder)
        throw new Error(
          "Screen recording is unavailable on this device. Try another format.",
        );
      const mr = selectedRecorder;
      recorder.current = mr;
      const chunks: Blob[] = [];
      let bytes = 0;
      mr.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.push(e.data);
          bytes += e.data.size;
          if (bytes > 220 * 1024 * 1024) {
            notify("Recording stopped at the 220 MB safety limit.");
            stopRecording();
          }
        }
      };
      mr.onerror = () => {
        error(
          "The recording could not continue. Try another screen or restart Frame.",
        );
        stopRecording();
      };
      mr.onstop = async () => {
        cleanupRecording();
        setRecordState("saving");
        setBusy(true);
        try {
          const durationMs = recordingClock.current.stop();
          const mime = recordingMime(mr.mimeType || chunks[0]?.type || "");
          const blob = await finalizeRecording(chunks, mime, durationMs);
          const capture = await api.save({
            name: `Recording · ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
            mime,
            bytes: new Uint8Array(await blob.arrayBuffer()),
            width,
            height,
            duration: durationMs / 1000,
            thumbnail,
          });
          await refresh();
          setView("videos");
          if (desktop) await api.present(capture.id);
          else await openCapture(capture);
        } catch (e) {
          error((e as Error).message);
        } finally {
          setRecordState("idle");
          await api.recordingState({ state: "idle", seconds: 0 });
          recorder.current = null;
          setBusy(false);
        }
      };
      stream.getVideoTracks()[0].onended = stopRecording;
      recordingClock.current.start();
      setSeconds(0);
      mr.start(1000);
      setRecordState("recording");
      await api.recordingState({ state: "recording", seconds: 0 });
    } catch (e) {
      cleanupRecording();
      setCountdown(null);
      if (
        (e as Error).name !== "NotAllowedError" &&
        (e as Error).message !== "Recording cancelled."
      )
        error((e as Error).message);
      setRecordState("idle");
      await api.recordingState({ state: "idle", seconds: 0 });
    } finally {
      setBusy(false);
    }
  }
  function pauseRecording() {
    const mr = recorder.current;
    if (!mr) return;
    if (mr.state === "recording") {
      mr.pause();
      recordingClock.current.pause();
      setSeconds(Math.floor(recordingClock.current.elapsed() / 1000));
      setRecordState("paused");
    } else if (mr.state === "paused") {
      mr.resume();
      recordingClock.current.resume();
      setRecordState("recording");
    }
  }
  useEffect(() => {
    if (recordState !== "idle")
      void api
        .recordingState({ state: recordState, seconds })
        .catch((e) => error(e.message));
  }, [recordState, seconds]);
  commandsRef.current = (command) => {
    if (command.startsWith("open:")) {
      const capture = items.find((c) => c.id === command.slice(5));
      if (capture) void openCapture(capture);
      return;
    }
    if (command === "library") {
      nav("all");
      return;
    }
    if (command === "pause-recording") {
      pauseRecording();
      return;
    }
    if (command === "record-area") {
      if (!busy && recordState === "idle" && countdown === null)
        void startRecording("cursor", true);
      return;
    }
    if (command === "quick-screen") {
      if (!busy && recordState === "idle" && countdown === null)
        void screenshot("screen", "cursor");
      return;
    }
    if (command === "shortcuts-changed")
      void api
        .info()
        .then(setInfo)
        .catch((e) => error(e.message));
    else if (command === "snip") {
      if (recordState !== "idle" || busy || countdown !== null) {
        notify("Finish the current capture or recording first.");
        return;
      }
      setHelp(false);
      setPalette(false);
      setRename(null);
      if (video) {
        URL.revokeObjectURL(video.url);
        setVideo(null);
      }
      void screenshot("region", "cursor");
    } else if (command === "stop-recording") stopRecording();
    else if (command === "import") fileInput.current?.click();
    else if (["region", "screen", "window", "record"].includes(command))
      action(command as CaptureMode);
  };
  useEffect(() => {
    const stop = api.onCommand((command) => commandsRef.current(command));
    void api.ready();
    return stop;
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        setCommandSearch("");
        setCommandIndex(0);
      }
      if (!desktop && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        fileInput.current?.click();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  async function favorite(c: Capture) {
    try {
      const updated = await api.update(c.id, { favorite: !c.favorite });
      setItems((items) => items.map((i) => (i.id === c.id ? updated : i)));
    } catch (e) {
      error((e as Error).message);
    }
  }
  async function remove(c: Capture) {
    try {
      await api.update(c.id, { deleted: true });
      setItems((items) => items.filter((i) => i.id !== c.id));
      notify("Capture moved out of the library.", false, () => {
        void api
          .update(c.id, { deleted: false })
          .then(() => refresh())
          .catch((e) => error(e.message));
        setNotice(null);
      });
    } catch (e) {
      error((e as Error).message);
    }
  }
  async function exportCapture(c: Capture, format?: "mp4" | "webm") {
    if (c.kind === "video" && !format) {
      setVideoExportFormat(c.mime === "video/mp4" ? "mp4" : "webm");
      setExportTarget(c);
      return;
    }
    if (exportBusy) return;
    setExportBusy(true);
    try {
      if (
        await api.exportFile(
          c.id,
          c.kind === "video" ? format! : settings.format,
        )
      ) {
        notify("Capture exported to your chosen file.");
        setExportTarget(null);
      }
    } catch (e) {
      error((e as Error).message);
    } finally {
      setExportBusy(false);
    }
  }
  const nav = (next: View) => {
    if (video) {
      URL.revokeObjectURL(video.url);
      setVideo(null);
    }
    setChooser(null);
    setRename(null);
    setHelp(false);
    setPalette(false);
    if (!exportBusy) setExportTarget(null);
    setView(next);
    setSearch("");
    setFilter("all");
  };
  const visible = items.filter(
    (c) =>
      (view !== "images" || c.kind === "image") &&
      (view !== "videos" || c.kind === "video") &&
      (view !== "favorites" || c.favorite) &&
      (filter === "all" || c.kind === filter) &&
      c.name.toLowerCase().includes(search.toLowerCase()),
  );
  const commandList = [
    { name: "Capture an area", hint: "⌘/Ctrl ⇧ 2", fn: () => action("region") },
    {
      name: "Capture full screen",
      hint: info?.platform === "darwin" ? "⌘ ⇧ 1" : "Ctrl ⇧ 3",
      fn: () => action("screen"),
    },
    { name: "Capture a window", hint: "", fn: () => action("window") },
    { name: "Record screen", hint: "⌘/Ctrl ⇧ 9", fn: () => action("record") },
    {
      name: "Import image",
      hint: "⌘/Ctrl O",
      fn: () => fileInput.current?.click(),
    },
    { name: "Open preferences", hint: "", fn: () => nav("settings") },
    { name: "Open all captures", hint: "", fn: () => nav("all") },
  ].filter((c) => c.name.toLowerCase().includes(commandSearch.toLowerCase()));
  return (
    <div
      className="app minimal-workspace"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files"))
          e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void importImage(file);
      }}
    >
      <input
        className="sr-only"
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Import image file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importImage(file);
        }}
      />
      <header className="app-header">
        <a
          href="#"
          className="brand"
          aria-label="Frame home"
          onClick={(e) => {
            e.preventDefault();
            nav("all");
          }}
        >
          <span className="brand-mark">
            <Scan size={20} strokeWidth={2.3} />
          </span>
          <span>
            frame<span className="brand-period">.</span>
          </span>
        </a>
        <span className="device-status">
          <HardDrive size={14} /> Stored on this device
        </span>
        <div className="app-header-actions">
          {desktop && (
            <button
              className="icon-button"
              aria-label="Hide to tray"
              title="Keep Frame ready in the tray"
              onClick={() => void api.hide()}
            >
              <PanelBottomClose size={18} />
            </button>
          )}
          {(view === "settings" || view === "editor") && (
            <button
              className="button library-return"
              aria-label="All captures"
              title="All captures"
              onClick={() => nav("all")}
            >
              <Grid2X2 size={16} /> All captures
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Quick actions"
            title={
              info?.platform === "darwin"
                ? "Quick actions (⌘ K)"
                : "Quick actions (Ctrl K)"
            }
            onClick={() => {
              setPalette(true);
              setCommandSearch("");
              setCommandIndex(0);
            }}
          >
            <Command size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Help and shortcuts"
            title="Help & shortcuts"
            onClick={() => setHelp(true)}
          >
            <Keyboard size={18} />
          </button>
          <button
            className={`icon-button ${view === "settings" ? "is-current" : ""}`}
            aria-label="Preferences"
            title="Preferences"
            aria-pressed={view === "settings"}
            onClick={() => nav("settings")}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </header>
      <main className={`main ${view === "editor" ? "main-editor" : ""}`}>
        {view === "editor" && selected ? (
          <Editor
            key={selected.id}
            capture={selected}
            settings={settings}
            onBack={() => nav("all")}
            onSaved={(c) => {
              void saved(c);
            }}
            onError={error}
          />
        ) : (
          <>
            {view === "settings" ? (
              <div className="settings-page">
                <div className="page-heading">
                  <div>
                    <h1>Preferences</h1>
                    <p>Capture, recording, and keyboard settings.</p>
                  </div>
                </div>
                <div className="settings-section">
                  <h2>Recording</h2>
                  <Setting
                    title="Microphone"
                    description="Add narration using your default microphone."
                  >
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="Microphone"
                      checked={settings.microphone}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          microphone: e.target.checked,
                        })
                      }
                    />
                  </Setting>
                  <Setting
                    title="System audio"
                    description={
                      info?.platform === "darwin"
                        ? "System audio is unavailable in this macOS build."
                        : "Include audio playing on your computer."
                    }
                  >
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="System audio"
                      disabled={info?.platform === "darwin"}
                      checked={
                        settings.systemAudio && info?.platform !== "darwin"
                      }
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          systemAudio: e.target.checked,
                        })
                      }
                    />
                  </Setting>
                  <Setting
                    title="Countdown"
                    description="A moment to get ready before recording."
                  >
                    <select
                      aria-label="Recording countdown"
                      value={settings.countdown}
                      onChange={(e) =>
                        setSettings({ ...settings, countdown: +e.target.value })
                      }
                    >
                      <option value="0">No countdown</option>
                      <option value="3">3 seconds</option>
                      <option value="5">5 seconds</option>
                    </select>
                  </Setting>
                  <Setting
                    title="Recording quality"
                    description={
                      recordingPreset(settings.recordingQuality).description
                    }
                  >
                    <select
                      aria-label="Recording quality"
                      value={settings.recordingQuality}
                      onChange={(e) => {
                        const quality = e.target
                          .value as Settings["recordingQuality"];
                        setSettings({
                          ...settings,
                          recordingQuality: quality,
                          fps: RECORDING_PRESETS[quality].fps,
                        });
                      }}
                    >
                      {Object.entries(RECORDING_PRESETS).map(([id, preset]) => (
                        <option key={id} value={id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </Setting>
                  <Setting
                    title="Video format"
                    description="MP4 works in most players. WebM offers VP9 compression."
                  >
                    <select
                      aria-label="Video format"
                      value={settings.recordingFormat}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          recordingFormat: e.target
                            .value as Settings["recordingFormat"],
                        })
                      }
                    >
                      <option value="mp4">MP4 · H.264</option>
                      <option value="webm">WebM · VP9</option>
                    </select>
                  </Setting>
                  <Setting
                    title="Frame rate"
                    description="15 fps suits tutorials and app work. Native resolution is preserved."
                  >
                    <select
                      aria-label="Frame rate"
                      value={settings.fps}
                      onChange={(e) =>
                        setSettings({ ...settings, fps: +e.target.value })
                      }
                    >
                      {FRAME_RATES.map((fps) => (
                        <option key={fps} value={fps}>
                          {fps} fps
                        </option>
                      ))}
                    </select>
                  </Setting>
                </div>
                <div className="settings-section">
                  <h2>Files</h2>
                  <Setting
                    title="Export format"
                    description="PNG preserves transparency. JPEG creates smaller files."
                  >
                    <select
                      aria-label="Export format"
                      value={settings.format}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          format: e.target.value as "png" | "jpg",
                        })
                      }
                    >
                      <option value="png">PNG</option>
                      <option value="jpg">JPEG</option>
                    </select>
                  </Setting>
                  <Setting
                    title="Capture library"
                    description={
                      info?.storagePath || "Loading storage location…"
                    }
                  >
                    {desktop && (
                      <button
                        className="button"
                        onClick={() =>
                          void api.openFolder().catch((e) => error(e.message))
                        }
                      >
                        <FolderOpen size={15} />
                        Open folder
                      </button>
                    )}
                  </Setting>
                  <Setting
                    title="Privacy"
                    description="Frame has no cloud service, accounts, analytics, or automatic uploads."
                  >
                    <ShieldCheck size={22} className="muted" />
                  </Setting>
                </div>
                {info?.platform === "darwin" && (
                  <div className="settings-section">
                    <h2>macOS permissions</h2>
                    <p className="settings-note">
                      Frame asks when you choose a capture or enable narration
                      for a recording. No camera, Accessibility, or Input
                      Monitoring access is needed.
                    </p>
                    {(["screen", "microphone"] as const).map((kind) => {
                      const status =
                        kind === "screen"
                          ? info.screenPermission
                          : info.microphonePermission;
                      return (
                        <Setting
                          key={kind}
                          title={
                            kind === "screen"
                              ? "Screen Recording"
                              : "Microphone"
                          }
                          description={
                            `Access: ${status}. ` +
                            (kind === "screen"
                              ? "Needed to capture other apps and displays."
                              : "Needed only for narration.")
                          }
                        >
                          <button
                            className="button"
                            disabled={permissionBusy !== null}
                            onClick={() =>
                              status === "not-determined"
                                ? void requestPermission(kind)
                                : void api
                                    .openPermissions(kind)
                                    .catch((e) => error(e.message))
                            }
                          >
                            {permissionBusy === kind
                              ? "Requesting…"
                              : status === "not-determined"
                                ? "Request access"
                                : "Open settings"}
                          </button>
                        </Setting>
                      );
                    })}
                    <p className="settings-note">
                      After changing access in System Settings, restart Frame if
                      capture is still blocked.
                    </p>
                    <button
                      className="button"
                      onClick={() =>
                        void api
                          .info()
                          .then(setInfo)
                          .catch((e) => error(e.message))
                      }
                    >
                      Check permissions
                    </button>
                  </div>
                )}
                <div className="settings-section">
                  <h2>Keyboard shortcuts</h2>
                  {info?.platform === "win32" && (
                    <>
                      <Setting
                        title="Use Win+Shift+S for Frame"
                        description="Capture an area on the screen under your pointer. Overrides Windows Snipping Tool while Frame is running."
                      >
                        <input
                          type="checkbox"
                          role="switch"
                          className="toggle"
                          aria-label="Use Win+Shift+S for Frame"
                          checked={info.snippingShortcut?.enabled || false}
                          disabled={shortcutBusy}
                          onChange={(e) =>
                            void toggleSnippingShortcut(e.target.checked)
                          }
                        />
                      </Setting>
                      <p className="settings-note" role="status">
                        {(shortcutBusy
                          ? "Updating shortcut…"
                          : info.snippingShortcut?.error) ||
                          (info.snippingShortcut?.active
                            ? "Win+Shift+S is active. Turning this off or quitting Frame restores Windows Snipping Tool."
                            : "Windows Snipping Tool keeps Win+Shift+S.")}
                      </p>
                    </>
                  )}
                  <div className="shortcut-setting">
                    <span>Capture area</span>
                    <kbd>
                      {info?.platform === "darwin" ? "⌘" : "Ctrl"} + Shift + 2
                    </kbd>
                  </div>
                  <div className="shortcut-setting">
                    <span>Capture screen</span>
                    <kbd>
                      {info?.platform === "darwin"
                        ? "⌘ + Shift + 1"
                        : "Ctrl + Shift + 3"}
                    </kbd>
                  </div>
                  <div className="shortcut-setting">
                    <span>Start / stop recording</span>
                    <kbd>
                      {info?.platform === "darwin" ? "⌘" : "Ctrl"} + Shift + 9
                    </kbd>
                  </div>
                  <p className="settings-note">
                    {desktop
                      ? "Shortcuts are global while Frame is open. " +
                        (Object.values(info?.shortcuts || {}).includes(false)
                          ? "Some shortcuts are in use by another app. Use the capture buttons instead."
                          : "")
                      : "Global shortcuts are available in the desktop app."}
                  </p>
                </div>
                <p className="settings-note app-version">
                  Frame {info?.version || __APP_VERSION__} ·{" "}
                  {info?.platform === "darwin"
                    ? "macOS"
                    : info?.platform === "win32"
                      ? "Windows"
                      : "Browser preview"}
                </p>
              </div>
            ) : (
              <div className="workspace-content">
                <section className="capture-toolbar" aria-label="Capture tools">
                  <button
                    className="button primary capture-area"
                    onClick={() => action("region")}
                    disabled={busy || recordState !== "idle"}
                  >
                    <Scan size={18} />
                    <span>Capture an area</span>
                    <kbd>{info?.platform === "darwin" ? "⌘" : "Ctrl"} ⇧ 2</kbd>
                  </button>
                  <button
                    className="button capture-tool"
                    onClick={() => action("screen")}
                    disabled={busy || recordState !== "idle"}
                  >
                    <Monitor size={18} />
                    <span>Full screen</span>
                  </button>
                  <button
                    className="button capture-tool"
                    onClick={() => action("window")}
                    disabled={busy || recordState !== "idle"}
                  >
                    <AppWindow size={18} />
                    <span>Window</span>
                  </button>
                  <button
                    className="button capture-tool"
                    aria-label="Screen recording"
                    onClick={() => action("record")}
                    disabled={busy || recordState !== "idle"}
                  >
                    <Video size={18} />
                    <span>Record</span>
                  </button>
                </section>
                {!desktop && (
                  <div className="preview-note">
                    <Monitor size={16} />
                    <span>
                      Browser preview · For global shortcuts, native area
                      selection, and local files, run the desktop app.
                    </span>
                  </div>
                )}
                <div className="library-heading">
                  <h1>
                    Captures{" "}
                    <span className="library-count">{visible.length}</span>
                  </h1>
                  <div className="library-tools">
                    <button
                      className="button import-button"
                      onClick={() => fileInput.current?.click()}
                      disabled={busy}
                    >
                      <Upload size={15} /> Import image
                    </button>

                    <div className="search-field">
                      <Search size={16} />
                      <input
                        aria-label="Search captures"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search captures…"
                      />
                      {search && (
                        <button
                          className="inline-clear"
                          aria-label="Clear search"
                          onClick={() => setSearch("")}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    <div
                      className="view-switch"
                      role="group"
                      aria-label="Library layout"
                    >
                      <button
                        aria-label="Grid view"
                        aria-pressed={layout === "grid"}
                        className={layout === "grid" ? "active" : ""}
                        onClick={() => setLayout("grid")}
                      >
                        <Grid2X2 size={16} />
                      </button>
                      <button
                        aria-label="List view"
                        aria-pressed={layout === "list"}
                        className={layout === "list" ? "active" : ""}
                        onClick={() => setLayout("list")}
                      >
                        <List size={17} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="library-navigation">
                  <nav className="library-tabs" aria-label="Capture library">
                    {(
                      [
                        { id: "all", label: "All captures" },
                        { id: "images", label: "Screenshots" },
                        { id: "videos", label: "Recordings" },
                        { id: "favorites", label: "Favorites" },
                      ] as const
                    ).map((n) => (
                      <button
                        key={n.id}
                        aria-current={view === n.id ? "page" : undefined}
                        className={view === n.id ? "active" : ""}
                        onClick={() => nav(n.id)}
                      >
                        {n.label}
                      </button>
                    ))}
                  </nav>
                  {view === "favorites" ? (
                    <select
                      aria-label="Filter favorites"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">All types</option>
                      <option value="image">Screenshots</option>
                      <option value="video">Recordings</option>
                    </select>
                  ) : (
                    <span className="library-order">Newest first</span>
                  )}
                </div>
                {loading ? (
                  <div className="empty-state">
                    <Spinner label="Opening your library…" />
                  </div>
                ) : visible.length ? (
                  <div
                    className={`capture-library ${layout === "list" ? "list-layout" : ""}`}
                  >
                    {visible.map((c) => (
                      <CaptureCard
                        key={c.id}
                        capture={c}
                        open={() => void openCapture(c)}
                        favorite={() => void favorite(c)}
                        remove={() => void remove(c)}
                        rename={() => {
                          setRename(c);
                          setNewName(c.name);
                        }}
                        exportFile={() => void exportCapture(c)}
                        reveal={() =>
                          void api.reveal(c.id).catch((e) => error(e.message))
                        }
                      />
                    ))}
                  </div>
                ) : search ||
                  filter !== "all" ||
                  view === "favorites" ||
                  (view === "images" && items.length) ||
                  (view === "videos" && items.length) ? (
                  <div className="empty-state">
                    <Search size={28} />
                    <h3>
                      {view === "favorites" && !search
                        ? "No favorites yet"
                        : "No matching captures."}
                    </h3>
                    <p>
                      {view === "favorites" && !search
                        ? "Star a capture to find it here."
                        : "Try another search or capture something new."}
                    </p>
                    <button
                      className="button"
                      onClick={() => {
                        setSearch("");
                        setFilter("all");
                        nav("all");
                      }}
                    >
                      View all captures
                    </button>
                  </div>
                ) : (
                  <div className="first-capture">
                    <span className="empty-capture-icon" aria-hidden="true">
                      <Scan size={30} strokeWidth={1.3} />
                    </span>
                    <div>
                      <h3>No captures yet</h3>
                      <p>Capture your screen or drop an image here.</p>
                      <div className="first-capture-actions">
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await document.fonts.ready;
                              await saveImage(
                                makeDemo(),
                                "Fieldnotes · practice image",
                              );
                            } catch (e) {
                              error((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Try the editor <ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
      {chooser && (
        <SourceChooser
          mode={chooser}
          info={info}
          settings={settings}
          setSettings={setSettings}
          onClose={() => setChooser(null)}
          onChoose={(id, area) =>
            chooser === "record"
              ? void startRecording(id, area)
              : void screenshot(chooser, id)
          }
        />
      )}
      {rename && (
        <Modal title="Rename capture" onClose={() => setRename(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              try {
                await api.update(rename.id, { name: newName.trim() });
                setRename(null);
                await refresh();
              } catch (e) {
                error((e as Error).message);
              }
            }}
          >
            <label className="field-label" htmlFor="capture-name">
              Capture name
            </label>
            <input
              className="text-input"
              id="capture-name"
              autoFocus
              maxLength={120}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="modal-actions">
              <button
                className="button"
                type="button"
                onClick={() => setRename(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={!newName.trim()}>
                Save name
              </button>
            </div>
          </form>
        </Modal>
      )}
      {video && (
        <Modal
          title={video.capture.name}
          wide
          onClose={() => {
            URL.revokeObjectURL(video.url);
            setVideo(null);
          }}
        >
          <video className="video-player" controls autoPlay src={video.url} />
          <div className="video-meta">
            <span>
              {video.capture.width} × {video.capture.height} ·{" "}
              {video.capture.mime === "video/mp4" ? "MP4" : "WebM"} ·{" "}
              {formatBytes(video.capture.bytes)}
            </span>
            <select
              aria-label="Export video format"
              value={videoExportFormat}
              disabled={exportBusy}
              onChange={(e) =>
                setVideoExportFormat(e.target.value as "mp4" | "webm")
              }
            >
              <option value="mp4">MP4 · H.264</option>
              <option value="webm">WebM · VP9</option>
            </select>
            <button
              disabled={exportBusy}
              className="button primary"
              onClick={() =>
                void exportCapture(video.capture, videoExportFormat)
              }
            >
              <Download size={16} />
              {exportBusy ? "Exporting…" : "Export video"}
            </button>
          </div>
        </Modal>
      )}
      {exportTarget && (
        <Modal
          title="Export recording"
          onClose={() => {
            if (!exportBusy) setExportTarget(null);
          }}
        >
          <label className="field-label" htmlFor="export-video-type">
            Video format
          </label>
          <select
            id="export-video-type"
            value={videoExportFormat}
            disabled={exportBusy}
            onChange={(e) =>
              setVideoExportFormat(e.target.value as "mp4" | "webm")
            }
          >
            <option value="mp4">MP4 · H.264</option>
            <option value="webm">WebM · VP9</option>
          </select>
          <p className="settings-note">
            Conversion runs locally. The original recording is preserved.
          </p>
          <div className="modal-actions">
            <button
              className="button"
              disabled={exportBusy}
              onClick={() => setExportTarget(null)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={exportBusy}
              onClick={() =>
                void exportCapture(exportTarget, videoExportFormat)
              }
            >
              {exportBusy ? "Exporting…" : "Export video"}
            </button>
          </div>
        </Modal>
      )}
      {help && (
        <Modal title="A few helpful shortcuts" onClose={() => setHelp(false)}>
          <p className="modal-description">
            Frame keeps your screenshots and recordings on this device.
          </p>
          <div className="help-shortcuts">
            {[
              ...(info?.platform === "win32" && info.snippingShortcut?.active
                ? [["Capture area under pointer", "Win + Shift + S"]]
                : []),
              ["Capture area", "Ctrl / ⌘ + Shift + 2"],
              [
                "Capture full screen",
                info?.platform === "darwin"
                  ? "⌘ + Shift + 1"
                  : "Ctrl + Shift + 3",
              ],
              ["Start / stop recording", "Ctrl / ⌘ + Shift + 9"],
              ["Quick actions", "Ctrl / ⌘ + K"],
              ["Import image", "Ctrl / ⌘ + O"],
              ["Paste image", "Ctrl / ⌘ + V"],
              ["Save edited copy", "Ctrl / ⌘ + S"],
              ["Undo / redo", "Ctrl / ⌘ + Z / Shift Z"],
            ].map(([label, key]) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
          </div>
          <p className="settings-note">
            In the editor, press A for arrow, R for rectangle, T for text, B for
            redaction, or C to crop. Select a mark and press Delete to remove
            it.
          </p>
          {info?.platform === "darwin" && (
            <p className="settings-note">
              Allow Frame in System Settings → Privacy & Security → Screen
              Recording, then restart the app.
            </p>
          )}
          <button className="button full" onClick={() => setHelp(false)}>
            Back to work <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {palette && (
        <Modal title="Quick actions" onClose={() => setPalette(false)}>
          <div className="palette-search">
            <Search size={18} />
            <input
              aria-label="Find an action"
              autoFocus
              value={commandSearch}
              placeholder="What would you like to do?"
              onChange={(e) => {
                setCommandSearch(e.target.value);
                setCommandIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCommandIndex((i) =>
                    Math.min(commandList.length - 1, i + 1),
                  );
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCommandIndex((i) => Math.max(0, i - 1));
                }
                if (e.key === "Enter" && commandList[commandIndex]) {
                  e.preventDefault();
                  setPalette(false);
                  commandList[commandIndex].fn();
                }
              }}
            />
          </div>
          <div className="command-results">
            {commandList.map((c, i) => (
              <button
                key={c.name}
                className={`command-row ${i === commandIndex ? "active" : ""}`}
                onClick={() => {
                  setPalette(false);
                  c.fn();
                }}
              >
                <span>{c.name}</span>
                <kbd>{c.hint || "↵"}</kbd>
              </button>
            ))}
            {!commandList.length && (
              <p className="settings-note">No actions match that search.</p>
            )}
          </div>
        </Modal>
      )}
      {countdown !== null && (
        <div className="countdown-overlay" role="status">
          <div>
            <span>{countdown}</span>
            <p>Get ready. Recording starts soon.</p>
          </div>
        </div>
      )}
      {!desktop && recordState !== "idle" && (
        <div className="recording-controls" role="status">
          <span
            className={`record-dot ${recordState === "paused" ? "paused" : ""}`}
          />
          <strong>
            {recordState === "saving"
              ? "Saving recording…"
              : durationLabel(seconds)}
          </strong>
          <span>
            {recordState === "paused"
              ? "Paused"
              : recordState === "recording"
                ? "Recording"
                : ""}
          </span>
          {recordState !== "saving" && (
            <>
              <button
                className="icon-button"
                aria-label={
                  recordState === "paused"
                    ? "Resume recording"
                    : "Pause recording"
                }
                onClick={pauseRecording}
              >
                {recordState === "paused" ? (
                  <Play size={18} />
                ) : (
                  <Pause size={18} />
                )}
              </button>
              <button className="stop-button" onClick={stopRecording}>
                <Square size={13} fill="currentColor" />
                Stop
              </button>
            </>
          )}
        </div>
      )}
      {busy && recordState === "idle" && countdown === null && !chooser && (
        <div className="busy-indicator">
          <Spinner label="Preparing capture…" />
        </div>
      )}
      {notice && (
        <div
          className={`toast ${notice.error ? "error" : ""}`}
          role={notice.error ? "alert" : "status"}
          onMouseEnter={() => clearTimeout(noticeTimer.current)}
        >
          <span>
            {notice.error ? <CircleHelp size={18} /> : <Check size={18} />}
          </span>
          <p>{notice.message}</p>
          {notice.undo && <button onClick={notice.undo}>Undo</button>}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Setting({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
function CaptureCard({
  capture: c,
  open,
  favorite,
  remove,
  rename,
  exportFile,
  reveal,
}: {
  capture: Capture;
  open: () => void;
  favorite: () => void;
  remove: () => void;
  rename: () => void;
  exportFile: () => void;
  reveal: () => void;
}) {
  const popover = useRef<HTMLDivElement>(null);
  return (
    <article className="capture-card">
      <button
        className="capture-thumbnail"
        onClick={open}
        aria-label={`Open ${c.name}`}
      >
        <img src={c.thumbnail} alt="" width={480} height={300} />
        {c.kind === "video" && (
          <>
            <span className="video-play">
              <Play size={20} fill="currentColor" />
            </span>
            <span className="video-duration">{durationLabel(c.duration)}</span>
          </>
        )}
        <span className="capture-kind">
          {c.kind === "image" ? <ImageIcon size={13} /> : <Video size={13} />}
        </span>
      </button>
      <div className="capture-card-info">
        <button className="capture-name" onClick={open} title={c.name}>
          {c.name}
        </button>
        <p>
          {new Date(c.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}{" "}
          <span>·</span> {c.width} × {c.height} <span>·</span>{" "}
          {formatBytes(c.bytes)}
        </p>
      </div>
      <div className="card-actions">
        <button
          className={`icon-button star-button ${c.favorite ? "is-favorite" : ""}`}
          aria-label={
            c.favorite ? `Unfavorite ${c.name}` : `Favorite ${c.name}`
          }
          aria-pressed={c.favorite}
          onClick={favorite}
        >
          <Star size={16} fill={c.favorite ? "currentColor" : "none"} />
        </button>
        <button
          className="icon-button"
          aria-label={`Actions for ${c.name}`}
          onClick={(event) => {
            const menu = popover.current;
            if (!menu) return;
            const rect = event.currentTarget.getBoundingClientRect();
            menu.style.left =
              Math.max(12, Math.min(rect.right - 190, innerWidth - 202)) + "px";
            menu.style.top =
              Math.max(12, Math.min(rect.bottom + 6, innerHeight - 245)) + "px";
            menu.togglePopover();
          }}
        >
          <MoreHorizontal size={18} />
        </button>
        <div ref={popover} popover="auto" className="capture-menu">
          <button
            onClick={() => {
              popover.current?.hidePopover();
              open();
            }}
          >
            <Pencil size={15} />
            {c.kind === "image" ? "Open editor" : "Play recording"}
          </button>
          <button
            onClick={() => {
              popover.current?.hidePopover();
              rename();
            }}
          >
            <TypeIcon />
            Rename
          </button>
          <button
            onClick={() => {
              popover.current?.hidePopover();
              exportFile();
            }}
          >
            <Download size={15} />
            Export file
          </button>
          {desktop && (
            <button
              onClick={() => {
                popover.current?.hidePopover();
                reveal();
              }}
            >
              <FolderOpen size={15} />
              Show in folder
            </button>
          )}
          <button
            className="danger"
            onClick={() => {
              popover.current?.hidePopover();
              remove();
            }}
          >
            <Trash2 size={15} />
            Remove capture
          </button>
        </div>
      </div>
    </article>
  );
}
function TypeIcon() {
  return <Pencil size={15} />;
}
function SourceChooser({
  mode,
  info,
  settings,
  setSettings,
  onClose,
  onChoose,
}: {
  mode: CaptureMode;
  info: AppInfo | null;
  settings: Settings;
  setSettings: (s: Settings) => void;
  onClose: () => void;
  onChoose: (id: string, area?: boolean) => void;
}) {
  const [type, setType] = useState<"screen" | "window">(
      mode === "window" ? "window" : "screen",
    ),
    [sources, setSources] = useState<Source[]>([]),
    [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0),
    [area, setArea] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api
      .sources(type)
      .then((s) => {
        if (active) {
          setSources(s);
          setSelected(s[0]?.id || "");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [type, revision]);
  return (
    <Modal
      title={
        mode === "record"
          ? "What would you like to record?"
          : mode === "region"
            ? "Choose a screen, then drag an area"
            : mode === "window"
              ? "Choose a window"
              : "Choose a screen"
      }
      wide
      onClose={onClose}
    >
      <p className="modal-description">
        {mode === "record"
          ? "Choose your source. Stop anytime with Ctrl / ⌘ + Shift + 9."
          : mode === "region"
            ? "Frame will step aside while you select exactly what you need."
            : "Frame will step aside before taking your screenshot."}
      </p>
      <div className="source-heading">
        {mode === "record" ? (
          <div className="filter-tabs">
            <button
              className={type === "screen" && !area ? "active" : ""}
              onClick={() => {
                setType("screen");
                setArea(false);
              }}
            >
              Screens
            </button>
            <button
              className={type === "window" ? "active" : ""}
              onClick={() => {
                setType("window");
                setArea(false);
              }}
            >
              Windows
            </button>
            <button
              className={area ? "active" : ""}
              onClick={() => {
                setType("screen");
                setArea(true);
              }}
            >
              Area
            </button>
          </div>
        ) : (
          <span>
            {type === "screen" ? "Available screens" : "Available windows"}
          </span>
        )}
        <button
          className="icon-button"
          aria-label="Refresh sources"
          onClick={() => setRevision((r) => r + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {loading ? (
        <div className="source-loading">
          <Spinner label="Finding capture sources…" />
        </div>
      ) : error ? (
        <div className="source-error" role="alert">
          <p>{error}</p>
          {info?.platform === "darwin" && (
            <button
              className="button"
              onClick={() => void api.openPermissions()}
            >
              Open screen permissions
            </button>
          )}
        </div>
      ) : !sources.length ? (
        <div className="source-error">
          <p>
            No capture sources found. Check screen recording permissions and try
            again.
          </p>
          {info?.platform === "darwin" && (
            <button
              className="button"
              onClick={() => void api.openPermissions()}
            >
              Open screen permissions
            </button>
          )}
        </div>
      ) : (
        <div className="sources-grid">
          {sources.map((s) => (
            <button
              key={s.id}
              className={`source-card ${selected === s.id ? "selected" : ""}`}
              onClick={() => setSelected(s.id)}
              aria-pressed={selected === s.id}
            >
              <img src={s.thumbnail} alt="" width={480} height={300} />
              <span>
                {type === "screen" ? (
                  <Monitor size={16} />
                ) : (
                  <AppWindow size={16} />
                )}
                <strong>{s.name}</strong>
                {selected === s.id && <Check size={17} />}
              </span>
            </button>
          ))}
        </div>
      )}
      {mode === "record" && (
        <div className="record-options">
          <label>
            <span>Quality</span>
            <select
              aria-label="Recording quality"
              value={settings.recordingQuality}
              onChange={(e) => {
                const quality = e.target.value as Settings["recordingQuality"];
                setSettings({
                  ...settings,
                  recordingQuality: quality,
                  fps: RECORDING_PRESETS[quality].fps,
                });
              }}
            >
              {Object.entries(RECORDING_PRESETS).map(([id, preset]) => (
                <option key={id} value={id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Format</span>
            <select
              aria-label="Video format"
              value={settings.recordingFormat}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  recordingFormat: e.target
                    .value as Settings["recordingFormat"],
                })
              }
            >
              <option value="mp4">MP4 · H.264</option>
              <option value="webm">WebM · VP9</option>
            </select>
          </label>
          <label>
            <span>Frame rate</span>
            <select
              aria-label="Recording frame rate"
              value={settings.fps}
              onChange={(e) =>
                setSettings({ ...settings, fps: +e.target.value })
              }
            >
              {FRAME_RATES.map((fps) => (
                <option key={fps} value={fps}>
                  {fps} fps
                </option>
              ))}
            </select>
          </label>
          <label>
            <Mic size={16} />
            <span>Microphone</span>
            <input
              type="checkbox"
              checked={settings.microphone}
              onChange={(e) =>
                setSettings({ ...settings, microphone: e.target.checked })
              }
            />
          </label>
          <label
            title={
              info?.platform === "darwin"
                ? "System audio is unavailable in this macOS build"
                : undefined
            }
          >
            <Volume2 size={16} />
            <span>System audio</span>
            <input
              type="checkbox"
              disabled={info?.platform === "darwin"}
              checked={settings.systemAudio && info?.platform !== "darwin"}
              onChange={(e) =>
                setSettings({ ...settings, systemAudio: e.target.checked })
              }
            />
          </label>
          <label>
            <span>Countdown</span>
            <select
              aria-label="Countdown"
              value={settings.countdown}
              onChange={(e) =>
                setSettings({ ...settings, countdown: +e.target.value })
              }
            >
              <option value="0">Off</option>
              <option value="3">3 sec</option>
              <option value="5">5 sec</option>
            </select>
          </label>
        </div>
      )}
      {mode === "record" && (
        <p className="recording-hint">
          {settings.fps} fps · Original resolution ·{" "}
          {recordingPreset(settings.recordingQuality).description}
        </p>
      )}
      <div className="modal-actions">
        <button className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={loading || !selected || !!error}
          onClick={() => onChoose(selected, area)}
        >
          {mode === "record" ? <Video size={16} /> : <Scan size={16} />}{" "}
          {mode === "record"
            ? area
              ? "Select recording area"
              : "Start recording"
            : mode === "region"
              ? "Select area"
              : "Capture"}
        </button>
      </div>
    </Modal>
  );
}
