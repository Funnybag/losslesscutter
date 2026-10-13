# resources/bin

这个目录存放程序运行所需的第三方可执行文件。**它们不随仓库分发**（`.gitignore` 里已忽略
`resources/bin/*`，只保留本说明文件），原因有两个：

1. win32 的 `ffmpeg.exe` 与 `ffprobe.exe` 各约 98 MB，会让每一次克隆都多背几百 MB；
2. 这些是 GPL 构建，作为二进制分发时要随附许可与源码获取方式，独立存放更好管理。

## 目录结构

```
resources/bin/
├── win32/            # Windows 便携版使用
│   ├── ffmpeg.exe
│   ├── ffprobe.exe
│   └── mp3gain.exe   # 实际是 mp3rgain（MIT），运行时按 mp3gain 调用
└── linux/            # 在 Linux 上跑源码或测试时使用
    ├── ffmpeg
    ├── ffprobe
    └── mp3gain
```

## 获取方式

```bash
npm ci                              # 先装依赖（adm-zip 在 devDependencies 里）
npm run fetch:bin                   # 按当前平台自动下载 ffmpeg / ffprobe / mp3rgain
npm run fetch:bin -- --platform=all # 一次拿齐 win32 与 linux
npm run fetch:bin -- --force        # 强制重下
```

脚本见 `scripts/fetch-binaries.js`，下载源与许可：

| 文件 | 来源 | 许可 |
| --- | --- | --- |
| `ffmpeg` / `ffprobe`（win32） | [gyan.dev ffmpeg builds](https://www.gyan.dev/ffmpeg/builds/) · essentials build | GPL-3.0（`--enable-gpl --enable-version3`） |
| `ffmpeg` / `ffprobe`（linux） | [johnvansickle.com static build](https://johnvansickle.com/ffmpeg/) · amd64 static | GPL-3.0 |
| `mp3gain` / `mp3gain.exe` | [M-Igashi/mp3rgain](https://github.com/M-Igashi/mp3rgain) | MIT |

手动放置也可以，把文件按上表命名丢进对应目录即可。

## 已知坑

- **Linux 版 mp3rgain（原 mp3gain）与 glibc 版本耦合**：某些第三方构建要求 glibc ≥ 2.32/2.33/2.34，
  在 Ubuntu 20.04（glibc 2.31）上会报 `GLIBC_2.32 not found`。用 `npm run fetch:bin` 拿官方
  release 里的 linux-x86_64 静态构建通常不会踩到，若仍报错请换一个与发行版匹配的构建。
- 跨平台的二进制在本机通常无法执行（Windows 上跑不了 linux 版，反之亦然），
  `fetch-binaries.js` 末尾的自检对异平台会打印“(无法执行，跨平台二进制属正常)”。
- 若同时用到 `ffmpeg-static` / `ffprobe-static` 这两个 npm 依赖，脚本在下载失败时会自动从
  `node_modules` 里复制本平台二进制作为兜底。

## 许可

二进制各自的许可与完整条款见仓库根目录的 `THIRD-PARTY-LICENSES.md` 与 `LICENSES/`。
如果你把二进制打进 Release 附件，请一并附上 `LICENSES/GPL-3.0.txt` 并在 Release 说明里给出
ffmpeg 对应源码的获取地址。
