'use strict';
/**
 * 获取运行所需的第三方二进制：ffmpeg / ffprobe / mp3rgain。
 *
 * 为什么需要这个脚本
 *   仓库里不包含任何二进制（见 .gitignore 的 resources/bin/*）：
 *   win32 的 ffmpeg.exe 与 ffprobe.exe 各约 98 MB，逼近 GitHub 单文件上限，
 *   而且会永久撑大每一次克隆。所以源码走 git，二进制走本脚本或 Release 附件。
 *
 * 用法
 *   node scripts/fetch-binaries.js                       # 按当前平台获取
 *   node scripts/fetch-binaries.js --platform=win32      # win32 | linux | all
 *   node scripts/fetch-binaries.js --force               # 已存在也重新下载
 *   node scripts/fetch-binaries.js --skip-mp3gain        # 只处理 ffmpeg / ffprobe
 *   node scripts/fetch-binaries.js --mp3gain-from <路径>  # 用本地已有的 mp3rgain 文件
 *
 * 依赖：Node 内置模块 + adm-zip（项目 devDependencies，`npm ci` 后可用）。
 * 许可：下载的 ffmpeg / ffprobe 为 GPL 构建，mp3rgain 为 MIT，详见 THIRD-PARTY-LICENSES.md。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tmpDir = path.join(root, 'resources', 'tmp');
const UA = 'losslesscutter-fetch-binaries';

const FFMPEG = {
  win32: {
    label: 'gyan.dev · essentials build',
    url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    license: 'GPL-3.0（构建配置含 --enable-gpl --enable-version3）',
    home: 'https://www.gyan.dev/ffmpeg/builds/',
  },
  linux: {
    label: 'johnvansickle.com · amd64 static',
    url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
    license: 'GPL-3.0（静态构建，含 GPL 组件）',
    home: 'https://johnvansickle.com/ffmpeg/',
  },
};

// mp3rgain（MIT）——本项目运行时把它当作 mp3gain 调用，因此安装后仍命名为 mp3gain
const MP3RGAIN_REPO = 'M-Igashi/mp3rgain';
const MP3RGAIN_ASSET = {
  win32: /windows-x86_64\.zip$/i,
  linux: /linux-x86_64\.tar\.gz$/i,
};

const binDirOf = (platform) => path.join(root, 'resources', 'bin', platform);
const exeName = (platform, base) => (platform === 'win32' ? `${base}.exe` : base);

function parseArgs(argv) {
  const opts = { platform: null, force: false, skipMp3gain: false, mp3gainFrom: null };
  for (const a of argv) {
    if (a.startsWith('--platform=')) opts.platform = a.split('=')[1];
    else if (a === '--force') opts.force = true;
    else if (a === '--skip-mp3gain') opts.skipMp3gain = true;
    else if (a.startsWith('--mp3gain-from=')) opts.mp3gainFrom = a.split('=')[1];
  }
  if (!opts.platform) opts.platform = process.platform === 'win32' ? 'win32' : 'linux';
  if (!['win32', 'linux', 'all'].includes(opts.platform)) {
    throw new Error('--platform 只支持 win32 | linux | all');
  }
  return opts;
}

function httpGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('重定向次数过多: ' + url));
    https
      .get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(httpGet(new URL(res.headers.location, url).toString(), redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} <- ${url}`));
        }
        resolve(res);
      })
      .on('error', reject);
  });
}

function download(url, dest) {
  return httpGet(url).then(
    (res) =>
      new Promise((resolve, reject) => {
        const total = Number(res.headers['content-length'] || 0);
        let got = 0;
        let lastTick = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          got += chunk.length;
          const now = Date.now();
          if (total && now - lastTick > 1500) {
            lastTick = now;
            process.stdout.write(`\r    下载 ${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
          }
        });
        res.pipe(out);
        out.on('finish', () => {
          if (total) process.stdout.write('\r');
          out.close(() => resolve(dest));
        });
        out.on('error', reject);
        res.on('error', reject);
      })
  );
}

async function getJson(url) {
  const res = await httpGet(url);
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function fetchText(url) {
  const res = await httpGet(url);
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function installFrom(dir, names, destDir, rename) {
  let installed = 0;
  const files = walk(dir);
  for (const name of names) {
    const hit = files.find((f) => path.basename(f).toLowerCase() === name.toLowerCase());
    if (!hit) continue;
    const dest = path.join(destDir, rename[path.basename(hit).toLowerCase()] || path.basename(hit));
    fs.copyFileSync(hit, dest);
    fs.chmodSync(dest, 0o755);
    console.log(`    已安装 ${dest}（${(fs.statSync(dest).size / 1048576).toFixed(1)} MB）`);
    installed++;
  }
  return installed;
}

function extractArchive(archive, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  if (archive.endsWith('.zip')) {
    const AdmZip = require('adm-zip');
    new AdmZip(archive).extractAllTo(outDir, true);
    return;
  }
  const r = spawnSync('tar', ['-xJf', archive, '-C', outDir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('tar 解压失败（需要支持 xz 的 tar）');
}

/** 兜底：从 npm 依赖 ffmpeg-static / ffprobe-static 复制本平台二进制 */
function copyFromNodeModules(platform, destDir) {
  const candidates = [
    path.join(root, 'node_modules', 'ffmpeg-static', exeName(platform, 'ffmpeg')),
    path.join(root, 'node_modules', 'ffprobe-static', 'bin', platform, 'x64', exeName(platform, 'ffprobe')),
    path.join(root, 'node_modules', 'ffprobe-static', 'bin', platform, exeName(platform, 'ffprobe')),
  ];
  let copied = 0;
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const isProbe = /probe/i.test(path.basename(src));
    const dest = path.join(destDir, exeName(platform, isProbe ? 'ffprobe' : 'ffmpeg'));
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);
    console.log(`    兜底复制 ${src} -> ${dest}`);
    copied++;
  }
  return copied;
}

async function fetchFfmpeg(platform, force) {
  const destDir = binDirOf(platform);
  fs.mkdirSync(destDir, { recursive: true });
  const targets = [exeName(platform, 'ffmpeg'), exeName(platform, 'ffprobe')].map((f) => path.join(destDir, f));
  if (!force && targets.every((f) => fs.existsSync(f))) {
    console.log(`[${platform}] ffmpeg / ffprobe 已存在，跳过（--force 强制重下）`);
    return;
  }
  const src = FFMPEG[platform];
  console.log(`[${platform}] ffmpeg 来源：${src.label}｜许可：${src.license}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const archive = path.join(tmpDir, path.basename(new URL(src.url).pathname));
  const stage = path.join(tmpDir, `stage-${platform}`);
  try {
    console.log(`[${platform}] 下载 ${src.url}`);
    await download(src.url, archive);
    extractArchive(archive, stage);
    const n = installFrom(stage, [exeName(platform, 'ffmpeg'), exeName(platform, 'ffprobe')], destDir, {});
    if (n < 2) throw new Error('解压后未找到完整的 ffmpeg / ffprobe');
  } catch (e) {
    console.warn(`[${platform}] 下载/解压失败：${e.message}`);
    console.warn(`[${platform}] 尝试从 node_modules 兜底复制（需先 npm ci）`);
    if (copyFromNodeModules(platform, destDir) === 0) {
      throw new Error('无法自动获取 ffmpeg / ffprobe。请手动下载后放到 resources/bin/：' + src.home);
    }
  } finally {
    fs.rmSync(archive, { force: true });
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

async function fetchMp3rgain(platform, opts) {
  const destDir = binDirOf(platform);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, exeName(platform, 'mp3gain')); // 运行时按 mp3gain 调用
  if (fs.existsSync(dest) && !opts.force) {
    console.log(`[${platform}] mp3gain（mp3rgain）已存在，跳过`);
    return;
  }
  if (opts.mp3gainFrom) {
    if (!fs.existsSync(opts.mp3gainFrom)) throw new Error('--mp3gain-from 指定的文件不存在：' + opts.mp3gainFrom);
    fs.copyFileSync(opts.mp3gainFrom, dest);
    fs.chmodSync(dest, 0o755);
    console.log(`[${platform}] 已从 ${opts.mp3gainFrom} 复制 mp3gain`);
    return;
  }
  const rel = await getJson(`https://api.github.com/repos/${MP3RGAIN_REPO}/releases/latest`);
  const asset = (rel.assets || []).find((a) => MP3RGAIN_ASSET[platform].test(a.name));
  if (!asset) throw new Error(`未在 ${rel.tag_name} 中找到 ${platform} 资产`);
  console.log(`[${platform}] mp3gain 来源：${MP3RGAIN_REPO} ${rel.tag_name}（MIT）`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const archive = path.join(tmpDir, asset.name);
  const stage = path.join(tmpDir, `stage-mp3gain-${platform}`);
  await download(asset.browser_download_url, archive);
  const sumAsset = (rel.assets || []).find((a) => a.name === asset.name + '.sha256');
  if (sumAsset) {
    const expected = (await fetchText(sumAsset.browser_download_url)).split(/\s+/)[0].toLowerCase();
    const actual = sha256(archive);
    if (expected !== actual) throw new Error(`校验和不匹配：${actual} != ${expected}`);
    console.log(`[${platform}] sha256 校验通过`);
  }
  extractArchive(archive, stage);
  const binary = exeName(platform, 'mp3rgain');
  const n = installFrom(stage, [binary], destDir, { [binary.toLowerCase()]: path.basename(dest) });
  fs.rmSync(archive, { force: true });
  fs.rmSync(stage, { recursive: true, force: true });
  if (!n) {
    console.log(`[${platform}] 未在压缩包内找到 ${binary}，请手动从 ${rel.html_url} 取用`);
    console.log(`[${platform}] 目标路径：${dest}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const platforms = opts.platform === 'all' ? ['win32', 'linux'] : [opts.platform];
  console.log(`目标平台：${platforms.join(', ')}（主机 ${process.platform}/${process.arch}，Node ${process.version}）`);
  for (const p of platforms) {
    await fetchFfmpeg(p, opts.force);
    if (!opts.skipMp3gain) {
      try {
        await fetchMp3rgain(p, opts);
      } catch (e) {
        console.warn(`[${p}] mp3gain 自动获取失败：${e.message}`);
        console.warn(`[${p}] 手动下载后放到：${path.join(binDirOf(p), exeName(p, 'mp3gain'))}`);
        console.warn(`[${p}] 上游：https://github.com/${MP3RGAIN_REPO}/releases（MIT）`);
      }
    }
  }
  for (const p of platforms) {
    for (const base of ['ffmpeg', 'ffprobe', 'mp3gain']) {
      const f = path.join(binDirOf(p), exeName(p, base));
      if (!fs.existsSync(f)) {
        console.log(`[${p}] 缺失 ${path.basename(f)}`);
        continue;
      }
      const args = base === 'mp3gain' ? [] : ['-version'];
      const r = spawnSync(f, args, { encoding: 'utf8', timeout: 20000 });
      const line = `${r.stdout || r.stderr || ''}`.split('\n').find((l) => l.trim()) || '(无法执行，跨平台二进制属正常)';
      console.log(`[${p}] ${path.basename(f)} → ${line.trim()}`);
    }
  }
  console.log('完成。二进制版本变化时请同步 THIRD-PARTY-LICENSES.md。');
}

main().catch((e) => {
  console.error('失败：' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
