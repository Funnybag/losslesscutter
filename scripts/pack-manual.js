'use strict';
// 手动交叉打包：解压缓存的 Electron 运行时 + 放入应用文件 + 内置 ffmpeg/mp3rgain 二进制。
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const ELECTRON_VERSION = '33.4.11';
const platform = process.argv[2] || 'win32';
const arch = process.argv[3] || 'x64';

// 找到缓存的 electron zip
const cacheDir = path.join(os.homedir(), '.cache', 'electron');
let zipPath = null;
try {
  for (const d of fs.readdirSync(cacheDir)) {
    const candidate = path.join(cacheDir, d, `electron-v${ELECTRON_VERSION}-${platform}-${arch}.zip`);
    if (fs.existsSync(candidate)) { zipPath = candidate; break; }
  }
} catch (e) { /* ignore */ }

if (!zipPath) {
  console.error('ERROR: 未找到缓存的 electron zip。请先运行一次 electron-packager 或手动下载。');
  process.exit(1);
}

const outDir = path.join(root, 'release', `LosslessCutter-${platform}-${arch}`);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

console.log('[1/4] 解压 Electron 运行时:', zipPath);
const zip = new AdmZip(zipPath);
zip.extractAllTo(outDir, true);

const oldExe = path.join(outDir, platform === 'win32' ? 'electron.exe' : 'electron');
const newExe = path.join(outDir, platform === 'win32' ? 'LosslessCutter.exe' : 'LosslessCutter');
if (fs.existsSync(oldExe)) {
  fs.renameSync(oldExe, newExe);
  console.log('[2/4] 已重命名', path.basename(oldExe), '->', path.basename(newExe));
} else {
  console.error('ERROR: 未找到', oldExe);
  process.exit(1);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

console.log('[3/4] 写入应用文件 -> resources/app/');
const appDir = path.join(outDir, 'resources', 'app');
copyDir(path.join(root, 'electron'), path.join(appDir, 'electron'));
copyDir(path.join(root, 'dist'), path.join(appDir, 'dist'));
fs.copyFileSync(path.join(root, 'package.json'), path.join(appDir, 'package.json'));

console.log('[4/4] 内置 ffmpeg/ffprobe/mp3rgain -> resources/' + platform + '/');
const binSrc = path.join(root, 'resources', 'bin', platform);
const binDest = path.join(outDir, 'resources', platform);
fs.mkdirSync(binDest, { recursive: true });
for (const f of fs.readdirSync(binSrc)) {
  fs.copyFileSync(path.join(binSrc, f), path.join(binDest, f));
}

// 删除 default_app.asar，让 Electron 使用我们的 resources/app/
const defaultApp = path.join(outDir, 'resources', 'default_app.asar');
if (fs.existsSync(defaultApp)) fs.rmSync(defaultApp);

// 精简：删除非中英文的 locale 与调试符号，缩小体积
const localesDir = path.join(outDir, 'locales');
if (fs.existsSync(localesDir)) {
  for (const f of fs.readdirSync(localesDir)) {
    if (f.endsWith('.pak') && !/^(en-US|zh-CN|zh-TW)\.pak$/.test(f)) {
      fs.rmSync(path.join(localesDir, f));
    }
  }
}
for (const f of fs.readdirSync(outDir)) {
  if (f.endsWith('.pdb')) fs.rmSync(path.join(outDir, f));
}

// 统一修正时间戳：Electron 运行时 zip 解压后文件 mtime 是 1980 DOS 纪元，
// Windows 资源管理器会把它显示成空白的“创建日期”，这里统一设为打包时刻。
console.log('[5/5] 统一修正文件时间戳…');
const touchTime = new Date();
function touchAll(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) touchAll(p);
    fs.utimesSync(p, touchTime, touchTime);
  }
}
touchAll(outDir);

// 统计体积
function du(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += du(p);
    else total += fs.statSync(p).size;
  }
  return total;
}
const sizeMB = (du(outDir) / 1024 / 1024).toFixed(1);
console.log('DONE ✔  输出目录:', outDir);
console.log('可执行文件:', path.join(outDir, path.basename(newExe)));
console.log('总体积约:', sizeMB, 'MB');
