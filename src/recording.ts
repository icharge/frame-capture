import { webmWithDuration } from "./webm.ts";
import type { Settings } from "./types";

export type RecordingQuality = "compact" | "balanced" | "high";
export type RecordingFormat = "mp4" | "webm";
export const FRAME_RATES = [10, 15, 20, 24, 30, 60] as const;
export const RECORDING_PRESETS = {
  compact: {
    label: "Compact · clear text",
    fps: 15,
    bitrate: 2_400_000,
    audioBitrate: 64_000,
    description: "Small files for tutorials and everyday app work.",
  },
  balanced: {
    label: "Balanced · smoother",
    fps: 30,
    bitrate: 4_200_000,
    audioBitrate: 96_000,
    description: "Smoother scrolling and animation, with larger files.",
  },
  high: {
    label: "High quality",
    fps: 30,
    bitrate: 6_000_000,
    audioBitrate: 128_000,
    description: "More detail for complex screens, with larger files.",
  },
} as const;
export function recordingPreset(quality: string) {
  return (
    RECORDING_PRESETS[quality as RecordingQuality] || RECORDING_PRESETS.compact
  );
}
export function recordingFrameRate(value: number) {
  return FRAME_RATES.includes(value as (typeof FRAME_RATES)[number])
    ? value
    : 15;
}
export function recordingBitrate(
  quality: string,
  width: number,
  height: number,
  fps: number,
) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("The recording source has invalid dimensions.");
  const preset = recordingPreset(quality);
  const pixels = (width * height) / (1920 * 1080);
  const motion = Math.pow(recordingFrameRate(fps) / preset.fps, 0.65);
  const minimum =
    quality === "high"
      ? 1_800_000
      : quality === "balanced"
        ? 1_200_000
        : 800_000;
  const maximum =
    quality === "high"
      ? 32_000_000
      : quality === "balanced"
        ? 20_000_000
        : 12_000_000;
  return (
    Math.round(
      Math.max(minimum, Math.min(maximum, preset.bitrate * pixels * motion)) /
        1000,
    ) * 1000
  );
}
export type ScreenRecorderOptions = MediaRecorderOptions & {
  videoKeyFrameIntervalDuration: number;
  audioBitrateMode: "variable";
};
export function recorderCandidates(
  settings: Pick<
    Settings,
    "recordingQuality" | "recordingFormat" | "fps" | "systemAudio"
  >,
  width: number,
  height: number,
  hasAudio: boolean,
  supports: (mime: string) => boolean = (mime) =>
    MediaRecorder.isTypeSupported(mime),
): ScreenRecorderOptions[] {
  const audio = hasAudio ? ",mp4a.40.2" : "";
  const mp4 = [
    "video/mp4;codecs=avc1.640034" + audio,
    "video/mp4;codecs=avc1" + audio,
    "video/mp4",
  ];
  const webm = hasAudio
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return (
    settings.recordingFormat === "webm" ? [...webm, ...mp4] : [...mp4, ...webm]
  )
    .filter(supports)
    .map((mimeType) => ({
      mimeType,
      videoBitsPerSecond: recordingBitrate(
        settings.recordingQuality,
        width,
        height,
        settings.fps,
      ),
      audioBitsPerSecond: settings.systemAudio
        ? Math.max(
            128_000,
            recordingPreset(settings.recordingQuality).audioBitrate,
          )
        : recordingPreset(settings.recordingQuality).audioBitrate,
      audioBitrateMode: "variable",
      videoKeyFrameIntervalDuration: 5000,
    }));
}
export function recordingMime(value: string): "video/mp4" | "video/webm" {
  const mime = value.split(";")[0].trim().toLowerCase();
  if (mime !== "video/mp4" && mime !== "video/webm")
    throw new Error("The recorder returned an unsupported video format.");
  return mime;
}
export async function finalizeRecording(
  chunks: Blob[],
  mime: string,
  milliseconds: number,
) {
  const type = recordingMime(mime);
  const blob = new Blob(chunks, { type });
  if (!blob.size)
    throw new Error("The recording was empty. Try recording again.");
  return type === "video/webm" && milliseconds > 0
    ? webmWithDuration(blob, milliseconds)
    : blob;
}
export class RecordingClock {
  private now: () => number;
  private started: number | null = null;
  private pausedAt: number | null = null;
  private stoppedAt: number | null = null;
  private pausedMs = 0;
  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }
  start() {
    this.started = this.now();
    this.pausedAt = null;
    this.stoppedAt = null;
    this.pausedMs = 0;
  }
  pause() {
    if (
      this.started !== null &&
      this.pausedAt === null &&
      this.stoppedAt === null
    )
      this.pausedAt = this.now();
  }
  resume() {
    if (this.pausedAt !== null && this.stoppedAt === null) {
      this.pausedMs += this.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }
  elapsed() {
    if (this.started === null) return 0;
    const end = this.stoppedAt ?? this.now();
    return Math.max(
      0,
      end -
        this.started -
        this.pausedMs -
        (this.pausedAt === null ? 0 : end - this.pausedAt),
    );
  }
  stop() {
    if (this.started !== null && this.stoppedAt === null)
      this.stoppedAt = this.now();
    return this.elapsed();
  }
}
