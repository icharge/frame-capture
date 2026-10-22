import type { Rect } from "./editorEngine";
export async function cropRecording(
  source: MediaStream,
  rect: Rect,
  fps: number,
) {
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = source;
  await video.play();
  const canvas = document.createElement("canvas");
  const x = Math.max(0, Math.floor(rect.x * video.videoWidth)),
    y = Math.max(0, Math.floor(rect.y * video.videoHeight));
  canvas.width = Math.max(
    2,
    Math.floor(
      Math.min(rect.width * video.videoWidth, video.videoWidth - x) / 2,
    ) * 2,
  );
  canvas.height = Math.max(
    2,
    Math.floor(
      Math.min(rect.height * video.videoHeight, video.videoHeight - y) / 2,
    ) * 2,
  );
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const draw = () =>
    ctx.drawImage(
      video,
      x,
      y,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  draw();
  const stream = canvas.captureStream(fps);
  source.getAudioTracks().forEach((t) => stream.addTrack(t));
  const timer = setInterval(draw, 1000 / fps);
  const dispose = () => {
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.pause();
    video.srcObject = null;
  };
  source
    .getVideoTracks()[0]
    .addEventListener(
      "ended",
      () => stream.getVideoTracks().forEach((t) => t.stop()),
      { once: true },
    );
  return { stream, dispose };
}
