import type { RecordingFormat, RecordingQuality } from "./recording";

export type Capture = {
  id: string;
  name: string;
  kind: "image" | "video";
  mime: string;
  width: number;
  height: number;
  bytes: number;
  duration: number;
  createdAt: string;
  favorite: boolean;
  thumbnail: string;
};
export type Source = {
  id: string;
  name: string;
  thumbnail: string;
  displayId?: string;
};
export type CaptureInput = {
  name: string;
  mime: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  thumbnail: string;
  duration?: number;
};
export type SnippingShortcut = {
  enabled: boolean;
  active: boolean;
  error: string;
};
export type PermissionKind = "screen" | "microphone";
export type PermissionStatus = { screen: string; microphone: string };
export type AppInfo = {
  platform: string;
  version: string;
  storagePath: string;
  screenPermission: string;
  microphonePermission: string;
  shortcuts: Record<string, boolean>;
  snippingShortcut?: SnippingShortcut;
};
export type FrameAPI = {
  info(): Promise<AppInfo>;
  setSnippingShortcut(enabled: boolean): Promise<SnippingShortcut>;
  list(): Promise<Capture[]>;
  read(id: string): Promise<{ data: string; mime: string }>;
  save(input: CaptureInput): Promise<Capture>;
  update(
    id: string,
    patch: { name?: string; favorite?: boolean; deleted?: boolean },
  ): Promise<Capture>;
  sources(type: "screen" | "window"): Promise<Source[]>;
  screenshot(input: {
    mode: "region" | "screen" | "window";
    sourceId: string;
  }): Promise<{ data: string; width: number; height: number } | null>;
  recordingSource(id: string, audio: boolean): Promise<void>;
  recordingState(state: boolean): Promise<void>;
  exportFile(
    id: string,
    format: "png" | "jpg" | "webm" | "mp4",
  ): Promise<boolean>;
  copyImage(data: string): Promise<boolean>;
  reveal(id: string): Promise<void>;
  openFolder(): Promise<unknown>;
  openPermissions(kind?: PermissionKind): Promise<unknown>;
  requestPermission(kind: PermissionKind): Promise<PermissionStatus>;
  onCommand(callback: (command: string) => void): () => void;
};
declare global {
  interface Window {
    frame?: FrameAPI;
  }
}
export type Settings = {
  microphone: boolean;
  systemAudio: boolean;
  countdown: number;
  format: "png" | "jpg";
  fps: number;
  recordingQuality: RecordingQuality;
  recordingFormat: RecordingFormat;
};
