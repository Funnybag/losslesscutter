# LosslessCutter

[简体中文](#简体中文) | [English](#english)

## 简体中文

> 项目标识：`losslesscutter`（仓库目录名与 npm package name）；应用显示名与可执行文件：`LosslessCutter`。

一款 Windows 桌面端无损剪辑软件：支持对 **MP3 / FLAC / WAV / AIFF** 等音频文件进行**无损剪切与增益**，以及对 **MP4 / MKV / MOV** 等视频文件进行**无损剪切（流复制，按关键帧对齐）与音量增益**。提供类似 Premiere Pro 的**可视化波形 / 胶片时间轴 + 可缩放**，可高精度定位。

---

### 一、功能特性

| 功能 | 说明 |
| --- | --- |
| ✂️ 无损剪切 | MP3 帧对齐（不重新编码）；FLAC/WAV/AIFF 逐样本精确 |
| 🔊 声音增益 | MP3 用 mp3rgain 无损增益；FLAC/WAV 无损重编码；可与剪切一次性导出 |
| 📈 可视化波形 | 实时波形图，拖动黄色入点/出点选取范围 |
| 🔍 可缩放时间轴 | 鼠标滚轮缩放、`Alt`+滚轮平移，时间标尺随缩放变化（类 PR） |
| 🎯 高精度定位 | 方向键 ←/→ 逐帧/逐采样移动播放线，`I`/`O` 以播放线设入点/出点 |
| 💾 输出设置 | 保存到原目录或指定文件夹；保持原格式 / 转 MP3 / 转 FLAC |
| 🎬 视频无损剪切 | MP4/MKV/MOV 等流复制（`-c copy`），入点/出点自动吸附关键帧 |
| 🔊 视频音量增益 | 音频轨按 dB 重编码，视频轨保持无损复制 |
| 🎞️ 胶片时间轴 | 关键帧缩略图条，滚轮缩放 + `Alt`+滚轮平移（类 PR） |

### 二、运行方法（便携版）

1. 解压 `LosslessCutter-win32-x64.zip`。
2. 双击其中的 **`LosslessCutter.exe`** 即可运行，无需安装。

> 首次运行若 Windows SmartScreen 弹出提示，请点击「更多信息」→「仍要运行」。这是未做代码签名的开源工具的正常现象。

### 三、使用步骤

#### 剪切 + 增益（一次导出）

1. 点击 **「📂 打开音频文件」**，或直接把音频文件拖入窗口。
2. 波形加载后，会显示一个覆盖全曲的蓝色选区：
   - 拖动**黄色入点/出点手柄**选取要保留的片段；
   - 或按 **方向键 ←/→** 移动红色播放线到目标位置（`Shift`+方向键将步长乘以 10），再按 `I` 设为入点、`O` 设为出点；
   - 「步长」可选 1 采样 / 0.1 ms / 1 ms / … / 1 帧，实现逐帧或逐采样定位。
3. （可选）拖动「声音增益」滑块设置增益（-20 ~ +20 dB，0 表示不改变）。
4. 点击 **「导出文件」**，即可一次性完成**剪切 + 增益 + 格式转换**，生成一个新文件（不改动原文件）。

#### 时间轴缩放与平移（类 PR）

- **鼠标滚轮**：在波形上滚动即可放大/缩小时间轴。
- **`Alt`+滚轮**：横向平移波形（左右移动视角）。
- 顶栏 `− / +` 按钮缩放，`⤢` 一键适应窗口。

#### 顶部菜单栏

- 常驻暗色菜单栏提供：打开文件、退出、选择整段音频、缩放时间轴、快捷键说明。

#### 保存设置

- **输出位置**：原文件目录，或指定文件夹（点「浏览…」）。
- **输出格式**：保持原格式 / 转换为 MP3 / 转换为 FLAC。

### 四、无损剪切的技术说明（重要）

不同格式的「无损」含义不同：

| 格式 | 剪切方式 | 精度 | 是否重编码 |
| --- | --- | --- | --- |
| **MP3** | 帧边界对齐复制 | ≈ 26 ms（44.1 kHz 下每帧 1152 采样） | ❌ 绝不重编码，音质不变 |
| **FLAC** | 无损重编码 | 逐采样（1/44100 s ≈ 0.023 ms） | ✅ 重编码，但 FLAC 本身无损 |
| **WAV / AIFF** | PCM 无损 | 逐采样 | ✅ PCM 重编码，无音质损失 |

> **MP3 为什么不能逐样本无损剪切？** MP3 数据按「帧」压缩存储，一帧在 44.1 kHz 下约 26 毫秒。若要逐样本精确裁剪 MP3，只能重新编码（有损），因此本工具采用**纯无损帧对齐**方式。软件会自动把入点/出点对齐到最近的帧边界，并在界面中显示「生效区间」。

> **MP3 无损增益**：通过 mp3rgain 直接修改每一帧的 `global_gain` 字段，**不重新编码**；但受 MP3 格式限制，增益步进约 1.5 dB，且默认启用防削波（避免爆音）。

### 五、内置组件

- **ffmpeg / ffprobe**（静态构建，用于解码、无损剪切与 FLAC/WAV 增益）
- **mp3rgain v3.6.0**（MP3 无损增益，MIT 许可，<https://github.com/M-Igashi/mp3rgain>）
- **Electron + wavesurfer.js**（界面与波形渲染）

便携版包含运行所需的依赖，无需另外安装运行环境。GitHub 源码仓库出于体积与许可考虑不含这些二进制；开发者可执行 `npm run fetch:bin` 获取，详见 [`resources/bin/README.md`](resources/bin/README.md)。

### 六、从源码构建（开发者）

环境要求：Node.js ≥ 18。

```bash
npm install                      # 安装依赖
npm run fetch:bin                # 获取 ffmpeg / ffprobe / mp3gain（仓库不含二进制）
npm run build:renderer           # 构建界面（输出到 dist/）
node scripts/test.js             # 端到端逻辑自测（生成测试音频并验证剪切/增益）
npm run pack:win                 # 打包 Windows x64 便携版 -> release/
```

打包产物位于 `release/LosslessCutter-win32-x64/`。

#### 目录结构

```text
losslesscutter/
├── electron/          # 主进程 (main.js / preload.js / audio.js)
├── src/               # 渲染进程界面源码
├── dist/              # 界面构建产物
├── resources/bin/     # ffmpeg / ffprobe / mp3rgain（不随仓库分发，见该目录 README）
├── scripts/           # 测试与打包脚本
├── release/           # 打包输出
├── LICENSES/          # 第三方许可全文（GPL-3.0 / LGPL-2.1）
└── THIRD-PARTY-LICENSES.md  # 第三方组件清单与分发义务
```

### 七、许可

- 本项目自有代码：**MIT**，见 [LICENSE](LICENSE)。
- 第三方组件：ffmpeg / ffprobe 为 GPL-3.0 构建，mp3rgain 为 MIT，Electron 为 MIT，wavesurfer.js 为 BSD-3-Clause。完整清单与分发义务见 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)，许可全文在 [LICENSES/](LICENSES/)。

---

## English

> Project identifier: `losslesscutter` (repository directory and npm package name). Application and executable name: `LosslessCutter`.

LosslessCutter is a Windows desktop tool for lossless audio and video editing. It supports lossless cutting and gain adjustment for audio formats such as **MP3 / FLAC / WAV / AIFF**, as well as keyframe-aligned, stream-copy cutting and audio gain for video formats such as **MP4 / MKV / MOV**. It provides a zoomable waveform and filmstrip timeline for precise navigation.

---

### 1. Features

| Feature | Description |
| --- | --- |
| ✂️ Lossless cutting | Frame-aligned MP3 cutting without re-encoding; sample-accurate FLAC/WAV/AIFF cutting |
| 🔊 Audio gain | Lossless MP3 gain with mp3rgain; lossless re-encoding for FLAC/WAV; combine gain and cutting in one export |
| 📈 Waveform | Real-time waveform with draggable yellow in/out handles |
| 🔍 Zoomable timeline | Scroll to zoom and use `Alt`+scroll to pan; the time ruler adjusts to the zoom level |
| 🎯 Precise navigation | Use the arrow keys to move the playhead by frame or sample, then press `I` or `O` to set the in or out point |
| 💾 Output options | Save beside the source or to a chosen folder; keep the original format or convert to MP3/FLAC |
| 🎬 Lossless video cutting | Stream-copy formats such as MP4/MKV/MOV with `-c copy`; cut points snap to keyframes |
| 🔊 Video audio gain | Re-encode the audio track by dB while copying the video track without re-encoding |
| 🎞️ Filmstrip timeline | Keyframe thumbnails with scroll-to-zoom and `Alt`+scroll-to-pan controls |

### 2. Run the portable version

1. Extract `LosslessCutter-win32-x64.zip`.
2. Double-click **`LosslessCutter.exe`**. No installation is required.

> If Windows SmartScreen appears on first launch, select **More info** → **Run anyway**. This is normal for unsigned open-source software.

### 3. How to use

#### Cut and adjust gain in one export

1. Click **Open audio file** or drag an audio file into the window.
2. Once the waveform loads, a blue selection spanning the full track is shown:
   - Drag the **yellow in/out handles** to select the segment to keep.
   - Use the **arrow keys** to move the red playhead. Hold `Shift` to multiply the step by 10, then press `I` to set the in point or `O` to set the out point.
   - Choose a step size such as 1 sample, 0.1 ms, 1 ms, or 1 frame for sample- or frame-level navigation.
3. (Optional) Adjust the **Audio gain** slider from -20 to +20 dB. A value of 0 leaves the gain unchanged.
4. Click **Export file** to cut, adjust gain, and convert the format in one operation. The result is saved as a new file; the source is not modified.

#### Zoom and pan the timeline

- **Scroll over the waveform** to zoom in or out.
- **`Alt`+scroll** to pan horizontally.
- Use the `− / +` buttons in the top bar to zoom, or `⤢` to fit the timeline to the window.

#### Top menu bar

- The persistent dark menu bar provides file opening, exit, full-track selection, timeline zoom, and keyboard shortcut help.

#### Output settings

- **Output location**: the source file's folder or a selected folder.
- **Output format**: keep the original format, or convert to MP3 or FLAC.

### 4. How lossless cutting works

“Lossless” works differently for each format:

| Format | Cutting method | Precision | Re-encoded? |
| --- | --- | --- | --- |
| **MP3** | Copy at frame boundaries | About 26 ms (1152 samples per frame at 44.1 kHz) | ❌ No; the compressed audio is not re-encoded |
| **FLAC** | Lossless re-encoding | Sample-accurate (1/44100 s ≈ 0.023 ms) | ✅ Yes, using the lossless FLAC codec |
| **WAV / AIFF** | Lossless PCM processing | Sample-accurate | ✅ Yes, using PCM; no audio quality is lost |

> **Why can't MP3 be cut losslessly at arbitrary sample positions?** MP3 audio is stored in compressed frames, each about 26 ms at 44.1 kHz. Cutting at an arbitrary sample position would require lossy re-encoding, so this app uses **frame-aligned copying**. It aligns the in/out points to nearby frame boundaries and displays the effective range in the interface.

> **Lossless MP3 gain**: mp3rgain modifies each frame's `global_gain` field without re-encoding. The MP3 format limits gain steps to about 1.5 dB; clipping prevention is enabled by default.

### 5. Included components

- **ffmpeg / ffprobe** (static builds for decoding, lossless cutting, and FLAC/WAV gain processing)
- **mp3rgain v3.6.0** (lossless MP3 gain, MIT license, <https://github.com/M-Igashi/mp3rgain>)
- **Electron + wavesurfer.js** (application interface and waveform rendering)

The portable build includes the runtime dependencies and requires no separate runtime installation. The GitHub source repository omits these binaries to limit repository size and account for licensing. To fetch them for development, run `npm run fetch:bin`; see [`resources/bin/README.md`](resources/bin/README.md).

### 6. Build from source

Requirements: Node.js ≥ 18.

```bash
npm install                      # Install dependencies
npm run fetch:bin                # Fetch ffmpeg / ffprobe / mp3gain (not included in the repository)
npm run build:renderer           # Build the interface into dist/
node scripts/test.js             # Run end-to-end logic checks for cutting and gain
npm run pack:win                 # Package the Windows x64 portable version into release/
```

The packaged application is written to `release/LosslessCutter-win32-x64/`.

#### Directory structure

```text
losslesscutter/
├── electron/          # Main process (main.js / preload.js / audio.js)
├── src/               # Renderer interface source
├── dist/              # Built interface
├── resources/bin/     # ffmpeg / ffprobe / mp3rgain (not distributed; see its README)
├── scripts/           # Test and packaging scripts
├── release/           # Packaging output
├── LICENSES/          # Full third-party license texts (GPL-3.0 / LGPL-2.1)
└── THIRD-PARTY-LICENSES.md  # Third-party component list and distribution obligations
```

### 7. License

- Original project code is licensed under the **MIT License**; see [LICENSE](LICENSE).
- Third-party components include GPL-3.0 builds of ffmpeg / ffprobe, mp3rgain under MIT, Electron under MIT, and wavesurfer.js under BSD-3-Clause. See [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) for the full list and distribution obligations, and [LICENSES/](LICENSES/) for the license texts.
