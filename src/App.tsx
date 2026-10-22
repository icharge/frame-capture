import { useCallback, useEffect, useRef, useState } from "react";
import {
  Aperture,
  Scan,
  Monitor,
  AppWindow,
  Video,
  Image as ImageIcon,
  Star,
  Settings2,
  FolderOpen,
  Plus,
  ArrowUpRight,
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
  Sparkles,
  HardDrive,
  ChevronRight,
  RefreshCw,
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
import type { AppInfo, Capture, Settings, Source } from "./types";
import Editor from "./Editor";
import { Modal, Spinner } from "./components";

type CaptureMode = "region" | "screen" | "window" | "record";
type View = "all" | "images" | "videos" | "favorites" | "settings" | "editor";
const defaultSettings: Settings = {
  microphone: false,
  systemAudio: false,
  countdown: 3,
  format: "png",
  fps: 30,
};
function readSettings(): Settings {
  try {
    return {
      ...defaultSettings,
      ...JSON.parse(localStorage.getItem("frame-settings") || "{}"),
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
    recordSeconds = useRef(0),
    importing = useRef(false);
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
      recordSeconds.current++;
      setSeconds(recordSeconds.current);
    }, 1000);
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
      if (shot)
        await saveImage(
          shot.data,
          `${mode === "region" ? "Area" : mode === "window" ? "Window" : "Screenshot"} · ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
        );
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
    if (recorder.current && recorder.current.state !== "inactive") {
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
    void api.recordingState(false);
  }
  async function startRecording(sourceId: string) {
    setChooser(null);
    setBusy(true);
    let stream: MediaStream | null = null;
    try {
      if (desktop) await api.recordingSource(sourceId, settings.systemAudio);
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: settings.fps },
        audio: settings.systemAudio,
      });
      recordStream.current = stream;
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
        setCountdown(n);
        await new Promise((r) => setTimeout(r, 1000));
        if (
          !stream.getVideoTracks()[0]?.readyState ||
          stream.getVideoTracks()[0].readyState === "ended"
        )
          throw new Error("Screen sharing ended before recording started.");
      }
      setCountdown(null);
      const mime = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime)
        throw new Error("WebM recording is unavailable on this device.");
      const mr = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 6000000,
      });
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
          const blob = new Blob(chunks, { type: "video/webm" });
          if (!blob.size)
            throw new Error("The recording was empty. Try recording again.");
          const capture = await api.save({
            name: `Recording · ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
            mime: "video/webm",
            bytes: new Uint8Array(await blob.arrayBuffer()),
            width,
            height,
            duration: recordSeconds.current,
            thumbnail,
          });
          await refresh();
          setView("videos");
          await openCapture(capture);
        } catch (e) {
          error((e as Error).message);
        } finally {
          setRecordState("idle");
          recorder.current = null;
          setBusy(false);
        }
      };
      stream.getVideoTracks()[0].onended = stopRecording;
      recordSeconds.current = 0;
      setSeconds(0);
      mr.start(1000);
      setRecordState("recording");
      await api.recordingState(true);
    } catch (e) {
      cleanupRecording();
      setCountdown(null);
      if ((e as Error).name !== "NotAllowedError") error((e as Error).message);
      setRecordState("idle");
    } finally {
      setBusy(false);
    }
  }
  function pauseRecording() {
    const mr = recorder.current;
    if (!mr) return;
    if (mr.state === "recording") {
      mr.pause();
      setRecordState("paused");
    } else if (mr.state === "paused") {
      mr.resume();
      setRecordState("recording");
    }
  }
  commandsRef.current = (command) => {
    if (command === "stop-recording") stopRecording();
    else if (command === "import") fileInput.current?.click();
    else if (["region", "screen", "window", "record"].includes(command))
      action(command as CaptureMode);
  };
  useEffect(() => api.onCommand((command) => commandsRef.current(command)), []);
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
  async function exportCapture(c: Capture) {
    try {
      if (
        await api.exportFile(
          c.id,
          c.kind === "video" ? "webm" : settings.format,
        )
      )
        notify("Capture exported to your chosen file.");
    } catch (e) {
      error((e as Error).message);
    }
  }
  const nav = (next: View) => {
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
  const titles: Record<string, string> = {
    all: "All captures",
    images: "Screenshots",
    videos: "Recordings",
    favorites: "Favorites",
    settings: "Preferences",
  };
  const commandList = [
    { name: "Capture an area", hint: "⌘/Ctrl ⇧ 2", fn: () => action("region") },
    {
      name: "Capture full screen",
      hint: "⌘/Ctrl ⇧ 3",
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
      className="app"
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
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            nav("all");
          }}
          aria-label="Frame home"
        >
          <span className="brand-mark">
            <Scan size={23} strokeWidth={2.5} />
          </span>
          <span>
            frame<span className="brand-period">.</span>
          </span>
        </a>
        <button
          className="command-trigger"
          onClick={() => {
            setPalette(true);
            setCommandSearch("");
            setCommandIndex(0);
          }}
        >
          <Search size={15} />
          <span>Quick actions</span>
          <kbd>{info?.platform === "darwin" ? "⌘" : "Ctrl"} K</kbd>
        </button>
        <div className="nav-caption">Workspace</div>
        <nav className="main-nav" aria-label="Capture library">
          {(
            [
              {
                id: "all",
                label: "All captures",
                icon: Grid2X2,
                count: items.length,
              },
              {
                id: "images",
                label: "Screenshots",
                icon: ImageIcon,
                count: items.filter((c) => c.kind === "image").length,
              },
              {
                id: "videos",
                label: "Recordings",
                icon: Video,
                count: items.filter((c) => c.kind === "video").length,
              },
              {
                id: "favorites",
                label: "Favorites",
                icon: Star,
                count: items.filter((c) => c.favorite).length,
              },
            ] as const
          ).map((n) => (
            <button
              key={n.id}
              className={`nav-item ${view === n.id ? "active" : ""}`}
              onClick={() => nav(n.id)}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              <span className="nav-count">{n.count}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-icon">
              <HardDrive size={19} />
            </span>
            <strong>Made to stay local</strong>
            <p>
              Your captures. Your device.
              <br />
              No account required.
            </p>
            <div>
              <span className="status-dot" />
              All files stored locally
            </div>
          </div>
          <button
            className={`nav-item ${view === "settings" ? "active" : ""}`}
            onClick={() => nav("settings")}
          >
            <Settings2 size={18} />
            <span>Preferences</span>
          </button>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            <span>Help & shortcuts</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="platform-label">
            <Aperture size={15} />
            <span>
              {info?.platform === "darwin"
                ? "Frame for macOS"
                : info?.platform === "win32"
                  ? "Frame for Windows"
                  : "Frame · Browser preview"}
            </span>
            <span>v{info?.version || __APP_VERSION__}</span>
          </div>
        </div>
      </aside>
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
            <header className="topbar">
              <div className="breadcrumb">
                <span>Workspace</span>
                <ChevronRight size={14} />
                <strong>{titles[view]}</strong>
              </div>
              <div className="topbar-right">
                <span className="local-status">
                  <ShieldCheck size={15} />
                  Local workspace
                </span>
                <button
                  className="icon-button"
                  title="Help & shortcuts"
                  aria-label="Help and shortcuts"
                  onClick={() => setHelp(true)}
                >
                  <Keyboard size={18} />
                </button>
              </div>
            </header>
            {view === "settings" ? (
              <div className="settings-page">
                <div className="page-heading">
                  <div>
                    <h1>Make yourself at home.</h1>
                    <p>A few preferences for the way you capture.</p>
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
                    title="Frame rate"
                    description="Higher frame rates create larger recordings."
                  >
                    <select
                      aria-label="Frame rate"
                      value={settings.fps}
                      onChange={(e) =>
                        setSettings({ ...settings, fps: +e.target.value })
                      }
                    >
                      <option value="24">24 fps</option>
                      <option value="30">30 fps</option>
                      <option value="60">60 fps</option>
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
                <div className="settings-section">
                  <h2>Keyboard shortcuts</h2>
                  <div className="shortcut-setting">
                    <span>Capture area</span>
                    <kbd>
                      {info?.platform === "darwin" ? "⌘" : "Ctrl"} + Shift + 2
                    </kbd>
                  </div>
                  <div className="shortcut-setting">
                    <span>Capture screen</span>
                    <kbd>
                      {info?.platform === "darwin" ? "⌘" : "Ctrl"} + Shift + 3
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
              </div>
            ) : (
              <div className="workspace-content">
                <div className="page-heading">
                  <div>
                    <div className="greeting">
                      <span className="tiny-mark" />A clear view of your work
                    </div>
                    <h1>
                      {view === "all"
                        ? "Good work. Worth capturing."
                        : titles[view]}
                    </h1>
                    <p>
                      {view === "all"
                        ? "Catch a detail. Tell the whole story. Keep it right here."
                        : view === "favorites"
                          ? "The captures you want to keep close."
                          : view === "videos"
                            ? "Walk someone through it, one recording at a time."
                            : "Every detail, ready for your next conversation."}
                    </p>
                  </div>
                  <button
                    className="button import-button"
                    onClick={() => fileInput.current?.click()}
                    disabled={busy}
                  >
                    <Upload size={16} />
                    Import image
                  </button>
                </div>
                {view === "all" && (
                  <div className="capture-launcher">
                    <div className="capture-main">
                      <div className="capture-main-copy">
                        <div className="capture-label">
                          <span className="capture-icon">
                            <Scan size={24} />
                          </span>
                          <span>Start with a screenshot</span>
                        </div>
                        <h2>
                          Big ideas.
                          <br />
                          Small details.
                        </h2>
                        <p>
                          Capture exactly what you need,
                          <br />
                          then make your point.
                        </p>
                        <button
                          className="button primary"
                          onClick={() => action("region")}
                          disabled={busy || recordState !== "idle"}
                        >
                          <Plus size={17} />
                          Capture an area{" "}
                          <kbd>
                            {info?.platform === "darwin" ? "⌘" : "Ctrl"} ⇧ 2
                          </kbd>
                        </button>
                      </div>
                      <div className="capture-art" aria-hidden="true">
                        <div className="art-grid" />
                        <div className="art-selection">
                          <span className="corner tl" />
                          <span className="corner tr" />
                          <span className="corner bl" />
                          <span className="corner br" />
                          <span className="art-sun" />
                          <div className="art-mountain back" />
                          <div className="art-mountain front" />
                          <div className="art-cursor">
                            <MouseCursor />
                          </div>
                          <span className="art-dimensions">640 × 480</span>
                        </div>
                        <span className="art-note">
                          Every pixel has a point.
                        </span>
                      </div>
                    </div>
                    <div className="capture-secondary">
                      <button
                        className="capture-option"
                        onClick={() => action("screen")}
                        disabled={busy || recordState !== "idle"}
                      >
                        <span className="capture-option-icon">
                          <Monitor size={22} />
                        </span>
                        <span>
                          <strong>Full screen</strong>
                          <small>The whole picture.</small>
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                      <button
                        className="capture-option"
                        onClick={() => action("window")}
                        disabled={busy || recordState !== "idle"}
                      >
                        <span className="capture-option-icon">
                          <AppWindow size={22} />
                        </span>
                        <span>
                          <strong>Window</strong>
                          <small>One app. In focus.</small>
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                      <button
                        className="capture-option record-option"
                        onClick={() => action("record")}
                        disabled={busy || recordState !== "idle"}
                      >
                        <span className="capture-option-icon">
                          <Video size={22} />
                        </span>
                        <span>
                          <strong>Screen recording</strong>
                          <small>Show how it happens.</small>
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                    </div>
                  </div>
                )}
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
                  <div>
                    <h2>
                      {view === "all" ? "Your capture library" : titles[view]}{" "}
                      <span>{visible.length}</span>
                    </h2>
                    <p>
                      {items.length
                        ? "A little context, always within reach."
                        : "Your next good idea starts here."}
                    </p>
                  </div>
                  <div className="library-tools">
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
                {(view === "all" || view === "favorites") && (
                  <div
                    className="filter-tabs"
                    role="group"
                    aria-label="Filter captures"
                  >
                    {[
                      { id: "all", label: "Everything" },
                      { id: "image", label: "Screenshots" },
                      { id: "video", label: "Recordings" },
                    ].map((t) => (
                      <button
                        key={t.id}
                        aria-pressed={filter === t.id}
                        className={filter === t.id ? "active" : ""}
                        onClick={() => setFilter(t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                    <span className="sort-label">
                      Newest first <ChevronDown size={13} />
                    </span>
                  </div>
                )}
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
                        ? "Keep your best work close."
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
                    <div className="first-capture-graphic">
                      <div className="stack-sheet sheet-back" />
                      <div className="stack-sheet sheet-front">
                        <Scan size={34} />
                        <span>Ready when you are.</span>
                      </div>
                    </div>
                    <div>
                      <h3>A fresh canvas for your work.</h3>
                      <p>
                        Take a screenshot, drop in an image, or try the editor
                        with a practice image.
                      </p>
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
                        <span>or drag an image here</span>
                      </div>
                    </div>
                  </div>
                )}
                <footer className="workspace-footer">
                  <span>
                    <ShieldCheck size={14} /> Yours, from capture to export.
                  </span>
                  <span>
                    Made for Windows & macOS{" "}
                    <span className="footer-dot">·</span> No cloud. Just
                    clarity.
                  </span>
                </footer>
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
          onChoose={(id) =>
            chooser === "record"
              ? void startRecording(id)
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
              {video.capture.width} × {video.capture.height} · WebM ·{" "}
              {formatBytes(video.capture.bytes)}
            </span>
            <button
              className="button primary"
              onClick={() => void exportCapture(video.capture)}
            >
              <Download size={16} />
              Export video
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
              ["Capture area", "Ctrl / ⌘ + Shift + 2"],
              ["Capture full screen", "Ctrl / ⌘ + Shift + 3"],
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
      {recordState !== "idle" && (
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
function MouseCursor() {
  return (
    <svg width="36" height="42" viewBox="0 0 36 42" fill="none">
      <path
        d="M5 3L30 24L19 26L13 37L5 3Z"
        fill="var(--color-ink)"
        stroke="var(--color-paper)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
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
  onChoose: (id: string) => void;
}) {
  const [type, setType] = useState<"screen" | "window">(
      mode === "window" ? "window" : "screen",
    ),
    [sources, setSources] = useState<Source[]>([]),
    [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
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
              className={type === "screen" ? "active" : ""}
              onClick={() => setType("screen")}
            >
              Screens
            </button>
            <button
              className={type === "window" ? "active" : ""}
              onClick={() => setType("window")}
            >
              Windows
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
      <div className="modal-actions">
        <button className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={loading || !selected || !!error}
          onClick={() => onChoose(selected)}
        >
          {mode === "record" ? <Video size={16} /> : <Scan size={16} />}{" "}
          {mode === "record"
            ? "Start recording"
            : mode === "region"
              ? "Select area"
              : "Capture"}
        </button>
      </div>
    </Modal>
  );
}
