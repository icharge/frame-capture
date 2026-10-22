# Recording size and quality

Frame 0.1.2 defaults to Compact, MP4/H.264, and 15 fps. This targets readable text and small files for tutorials and app work. Balanced and High quality use 30 fps for smoother movement. Native source dimensions are preserved.

## Controlled Windows comparison

Measured on 2026-10-22 with Electron 45.0.0 using `npm run benchmark:recording`.

The same 1920 × 1080 canvas is recorded for seven seconds without audio. It contains 12 px source code, 14 px interface text, four seconds of scrolling, chart updates, and a moving pointer. The final two seconds are static. The old profile reproduces Frame 0.1.1's VP9, 30 fps, 6 Mbps settings; Compact profiles use the production encoder-options function, 15 fps, 2.4 Mbps, detail content hint, and a five-second keyframe interval.

| Profile                  | File bytes | Decimal MB | Reduction vs old | Full-frame SSIM | Text-region SSIM |
| ------------------------ | ---------: | ---------: | ---------------: | --------------: | ---------------: |
| Old Frame · VP9 · 30 fps |  3,289,416 |       3.29 |                — |        0.967613 |         0.931477 |
| Compact · VP9 · 15 fps   |  1,155,120 |       1.16 |            64.9% |        0.964291 |         0.925893 |
| Compact · H.264 · 15 fps |  1,146,187 |       1.15 |            65.2% |        0.962119 |         0.921661 |

All three outputs retain 1920 × 1080 pixels. SSIM compares a decoded frame after six seconds against the uncompressed reference, in YUV 4:4:4. The text crop is 995 × 780 pixels starting at (307, 205). A score closer to one means greater similarity; it is not a percentage of perceived quality. The Compact MP4 has a small fidelity loss relative to the old profile. Native-size text samples remain readable on visual inspection.

These numbers describe this fixture and machine. They do not establish equivalent quality to FastStone or predict every recording's size. FastStone itself was not benchmarked. Fifteen fps sacrifices motion smoothness; use Balanced or a higher frame rate for animation and fast scrolling. High motion, fine color detail, 4K screens, encoder implementation, and audio change the result.

## Reproduce and inspect

Install FFmpeg and ffprobe on PATH for analysis only, then run:

```sh
npm ci
npm run build
npm run benchmark:recording
npm run test:recording
```

The benchmark writes original recordings, reference/frame PNGs, and machine-readable scores to `test-results/recording-benchmark/`. Its raw WebM encoder samples intentionally skip app finalization and can report no duration; the native application test separately verifies finalized WebM metadata and seeking.

The native test captures a dedicated window, injects a synthetic narration stream without opening the physical microphone, and checks MP4/H.264/AAC and WebM/VP9/Opus. It verifies dimensions, finite duration, exclusion of paused time, seeking, complete decoding with no FFmpeg errors, correct export extensions, and identical bytes on export. Run it against a packaged executable with `FRAME_EXECUTABLE` set to that executable's absolute path. Test artifacts stay in ignored directories.

## Encoding and container behavior

At 1080p, Compact requests 2.4 Mbps at 15 fps, Balanced 4.2 Mbps at 30 fps, and High quality 6 Mbps at 30 fps. Bitrate scales with pixel count and frame rate, with bounds to avoid extreme budgets. Microphone-only audio requests 64/96/128 kbps by preset, and enabling system audio requests at least 128 kbps. MediaRecorder treats these budgets as hints; Frame does not promise a fixed size per minute.

Frame tries supported native H.264 MP4 or VP9 WebM codecs in preference order, then available fallbacks. Actual output MIME determines library storage, playback, and export extensions. MP4 is encoded directly, avoiding an extra lossy export conversion. Native recording needs no FFmpeg. Frame 0.2.0 bundles FFmpeg for optional local conversion between MP4 and WebM during export; exporting the native format still copies the original bytes. No cloud or upload service is used.

For new Chromium streaming WebM recordings, Frame adds duration to the small Info header, preserving encoded clusters verbatim. It retains the existing TimestampScale and unknown-length Segment/Cluster boundaries. Unexpected header layouts are preserved rather than rewritten. The regression test ensures that adding duration leaves cluster bytes unchanged.

Windows recording was exercised in this workspace. macOS capture, permissions, and codec behavior still need verification on a Mac.

## References

- [FastStone Capture features](https://www.faststone.org/FSCaptureDetail.htm): MP4/WMV recording and quality/frame-rate controls.
- [W3C MediaStream Recording](https://www.w3.org/TR/mediastream-recording/): encoder bitrate hints and MediaRecorder behavior.
- [W3C MediaStreamTrack content hints](https://w3c.github.io/mst-content-hint/): detail hints for edges and text.
- [Matroska element definitions](https://www.matroska.org/technical/elements.html): Duration, TimestampScale, and unknown-size Clusters.
