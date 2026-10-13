# 第三方组件与许可

本仓库自身的代码以 **MIT** 许可发布，见根目录 [LICENSE](LICENSE)。
本项目在运行时调用若干第三方组件，其中可执行文件**不作为仓库内容分发**（见 `.gitignore` 与
`resources/bin/README.md`），由 `npm run fetch:bin` 或 Release 附件提供。

## 一、运行时二进制

| 组件 | 本仓库记录的版本 | 许可 | 上游 |
| --- | --- | --- | --- |
| `ffmpeg` / `ffprobe`（win32） | 9.0.1-essentials_build（gyan.dev 构建） | GPL-3.0（构建配置含 `--enable-gpl --enable-version3`） | <https://www.gyan.dev/ffmpeg/builds/> |
| `ffmpeg` / `ffprobe`（linux） | 7.0.2-static（johnvansickle 构建） | GPL-3.0 | <https://johnvansickle.com/ffmpeg/> |
| `mp3gain` / `mp3gain.exe`（实为 mp3rgain） | 3.6.0 | MIT | <https://github.com/M-Igashi/mp3rgain> |

> 本项目的 MP3 增益走 mp3rgain（一个用 Rust 重写的 mp3gain，逐帧改写 `global_gain`，不重新编码）。
> 运行时按历史上的名字 `mp3gain` / `mp3gain.exe` 调用它，所以文件名保持不变。

## 二、构建与运行依赖（npm）

| 组件 | 版本 | 许可 |
| --- | --- | --- |
| Electron | 33.x | MIT |
| Vite | 6.x | MIT |
| wavesurfer.js | 7.x | BSD-3-Clause |
| adm-zip | 0.5.x | MIT |
| archiver | 6.x | MIT |
| @electron/packager | 18.x | BSD-2-Clause |
| ffmpeg-static / ffprobe-static | 5.x / 3.x | MIT（仅下载器包装；其下载的二进制仍是上表的 GPL 构建） |

完整依赖树以 `package-lock.json` 为准。

## 三、GPL 合规要点

把内含 ffmpeg 的二进制（例如 `LosslessCutter-win32-x64.zip`）作为 GitHub Release 附件分发时：

1. **随附许可全文** —— 本仓库已包含 [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt)，
   把它一起放进 Release 附件，或在 Release 说明中链接到本文件；
2. **给出对应源码的获取方式** —— ffmpeg 官方源码：<https://ffmpeg.org/download.html>；
   第三方静态构建的构建脚本与配置见其站点；也可以在 Release 说明里写一份不少于三年的书面要约；
3. **保留原有声明、不混淆来源** —— 本项目未重命名 `ffmpeg` / `ffprobe`；
4. 你的自有代码通过子进程调用 ffmpeg，不是链接进同一个可执行文件，因此自有代码可以继续用 MIT；
   但**二进制本身是 GPL 作品，分发它就触发上面 1、2 两条义务**。

> 可选简化路线（自行评估）：本工具的视频路径只做 `-c copy` 转封装，音频增益只需 MP3/FLAC 编解码，
> 理论上可以换用不带 GPL 组件的 ffmpeg 构建（`--disable-gpl`，MP3 编码用 LGPL 的 libmp3lame）。
> 采用哪种构建直接影响分发义务，换之前请先确认所需编解码器都还在。

## 四、自行核验版本

```bash
resources/bin/win32/ffmpeg.exe -version     # 第一行含版本与构建站点，configuration 行可确认 --enable-gpl
resources/bin/win32/mp3gain.exe             # 打印 "mp3rgain version x.y.z"
resources/bin/linux/ffmpeg -version
```

记录到上表；若与表中版本不一致，请同步更新本文件。

## 五、待办

- [ ] 内置 mp3rgain 为 3.6.0，上游已是 3.11.1；升级前先在 Windows 上跑 `node scripts/test.js`
      确认命令行参数（`-g` / `-d` / `-r` 等）行为一致。
- [ ] 决定 Release 是否附带 linux 版二进制；若只发 Windows 便携版，可省掉 linux 目录。
