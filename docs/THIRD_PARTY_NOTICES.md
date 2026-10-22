# Third-party notices

Frame bundles its runtime dependencies locally. No dependency is downloaded while capturing or exporting.

## FFmpeg and ffmpeg-static

Local video conversion uses ffmpeg-static 5.3.0 (GPL-3.0-or-later).

- Package source: https://github.com/eugeneware/ffmpeg-static
- Binary release pinned by that package: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1
- The Windows package's FFmpeg binary is version 6.1.1-essentials_build-www.gyan.dev, GPL v3.
- Exact Windows FFmpeg source revision reported by its bundled README: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93

The installed resources/licenses folder includes ffmpeg-static.LICENSE, ffmpeg.LICENSE, and ffmpeg.README. The binary's README records its upstream provider, source revision, and build configuration. Mac packages include the matching architecture's binary README and license beside resources/native/ffmpeg. The npm package version and native FFmpeg version are distinct: 5.3.0 is the latest npm release checked on 2026-10-22, and its pinned upstream binary is 6.1.1.

FFmpeg runs as a separate local process for format conversion. Native recording uses Chromium's MediaRecorder. See the included license text and corresponding upstream source/build information when redistributing the bundled binaries.

## Other components

Electron includes its own LICENSE and LICENSES.chromium.html. React, Lucide, Vite, and the other package licenses remain in the installed dependencies. Inter and Space Grotesk fonts are bundled from @fontsource; their font packages contain the SIL Open Font License.
