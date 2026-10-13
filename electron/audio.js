'use strict';

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PLATFORM_DIR = process.platform === 'win32' ? 'win32' : 'linux';
const BIN_EXT = process.platform === 'win32' ? '.exe' : '';

// 定位内置的 ffmpeg / ffprobe / mp3gain 二进制。
// 打包后：extra-resource=resources/bin/win32 -> 位于 process.resourcesPath/win32/xxx.exe
// 开发时：位于 <project>/resources/bin/<platform>/xxx
function resolveBin(name) {
  const exeName = name + BIN_EXT;
  const candidates = [
    path.join(process.resourcesPath || '', PLATFORM_DIR, exeName),
    path.join(process.resourcesPath || '', 'bin', PLATFORM_DIR, exeName),
    path.join(__dirname, '..', 'resources', 'bin', PLATFORM_DIR, exeName),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

const FFMPEG = () => resolveBin('ffmpeg');
const FFPROBE = () => resolveBin('ffprobe');
const MP3GAIN = () => resolveBin('mp3gain');

// 执行命令（文本输出），支持解析 ffmpeg -progress 进度。
function run(bin, args, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      if (onProgress) {
        const m = s.match(/out_time_us=(\d+)/g);
        if (m) {
          const last = m[m.length - 1];
          const us = parseInt(last.split('=')[1], 10);
          if (!Number.isNaN(us)) onProgress(us / 1e6);
        }
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `命令退出码 ${code}`));
      }
      resolve({ stdout, stderr });
    });
  });
}

// 执行命令，返回二进制 stdout（用于 ffmpeg 输出到 pipe:1 的场景）。
// timeoutMs：可选超时（毫秒），超时后终止子进程并 reject，避免高分辨率视频解码卡死。
function runRaw(bin, args, { onProgress, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const chunks = [];
    let stderr = '';
    let settled = false;
    let timer = null;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill(); } catch (e) { /* ignore */ }
        reject(new Error(`命令超时（${Math.round(timeoutMs / 1000)} 秒）：${path.basename(bin)}`));
      }, timeoutMs);
    }
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `命令退出码 ${code}`));
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

function formatSeconds(sec) {
  return (Number(sec) || 0).toFixed(6);
}

// 读取音频元信息。
async function probe(input) {
  const { stdout } = await run(FFPROBE(), [
    '-v', 'error',
    '-show_entries',
    'format=duration,format_name,bit_rate:stream=codec_name,codec_type,sample_rate,channels,bit_rate,bits_per_sample',
    '-of', 'json',
    input,
  ]);
  const data = JSON.parse(stdout);
  const audio = (data.streams || []).find((s) => s.codec_type === 'audio') || {};
  const sampleRate = parseInt(audio.sample_rate, 10) || 0;
  return {
    duration: parseFloat((data.format && data.format.duration) || 0) || 0,
    format: (data.format && data.format.format_name) || '',
    codec: audio.codec_name || '',
    sampleRate,
    channels: parseInt(audio.channels, 10) || 0,
    bitRate: parseInt(audio.bit_rate || (data.format && data.format.bit_rate), 10) || 0,
    bitDepth: parseInt(audio.bits_per_sample, 10) || 0,
    // MP3 每帧采样数（MPEG-1 Layer III = 1152），用于帧对齐提示。
    mp3FrameSec: sampleRate ? 1152 / sampleRate : 0,
  };
}

// 生成用于可视化预览的单声道 WAV 字节（任意格式 -> PCM）。
async function decodePreview(input) {
  const info = await probe(input);
  const sr = Math.min(info.sampleRate || 44100, 44100);
  return runRaw(FFMPEG(), [
    '-hide_banner', '-nostats', '-y',
    '-i', input,
    '-map', '0:a:0', '-vn',
    '-ac', '1', '-ar', String(sr),
    '-c:a', 'pcm_s16le', '-f', 'wav',
    'pipe:1',
  ]);
}

function extOf(p) {
  return path.extname(p).slice(1).toLowerCase();
}

// 生成唯一的输出路径（若已存在则追加 (n)）。
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${base}(${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base}_${Date.now()}${ext}`);
}

// 依据用户设置确定输出扩展名。
function outputExt(input, format) {
  if (format === 'mp3') return 'mp3';
  if (format === 'flac') return 'flac';
  return extOf(input) || 'wav'; // same as source
}

function resolveOutputDir(input, outDir, customDir) {
  if (outDir === 'custom' && customDir) return customDir;
  return path.dirname(input);
}

function buildOutputPath(input, suffix, ext, outDir, customDir) {
  const dir = resolveOutputDir(input, outDir, customDir);
  const base = path.basename(input, path.extname(input));
  const safeSuffix = suffix.replace(/[\\/:*?"<>|]/g, '_');
  return uniquePath(path.join(dir, `${base}${safeSuffix}.${ext}`));
}

// 无损剪切。
// MP3  -> -c copy 帧对齐（绝不重编码）；FLAC -> 无损重编码（逐样本精确）；
// WAV/AIFF -> PCM 无损重编码保证精确裁剪。
async function cut({ input, start, end, format, outDir, customDir }, onProgress) {
  const inExt = extOf(input);
  const outExt = outputExt(input, format);
  const suffix = `_剪切_${formatSeconds(start)}-${formatSeconds(end)}`;
  const output = buildOutputPath(input, suffix, outExt, outDir, customDir);

  const args = [
    '-hide_banner', '-nostats', '-y',
    '-progress', 'pipe:1',
    '-i', input,
    '-ss', formatSeconds(start),
    '-to', formatSeconds(end),
    '-map', '0:a:0',
  ];

  if (outExt === 'mp3') {
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
  } else if (outExt === 'flac') {
    args.push('-c:a', 'flac', '-compression_level', '5');
  } else if (outExt === 'wav') {
    args.push('-c:a', 'pcm_s16le');
  } else if (outExt === 'aiff' || outExt === 'aif') {
    args.push('-c:a', 'pcm_s16be');
  } else {
    args.push('-c', 'copy');
  }
  args.push(output);

  await run(FFMPEG(), args, { onProgress });
  return {
    output,
    method: outExt === 'mp3' ? 'lossless-frame' : 'lossless-sample',
    note: outExt === 'mp3'
      ? 'MP3 无损剪切：已按帧边界对齐（约 ' + (1152 / 44100 * 1000).toFixed(1) + 'ms 精度），不重新编码。'
      : '无损剪切：逐样本精确，无音质损失。',
  };
}

// 声音增益。
// MP3  -> mp3gain 无损增益（调整帧内 global_gain，不重新编码）。
// 其他 -> ffmpeg 无损重编码（FLAC/WAV 本身无损）。
async function applyGain({ input, db, outDir, customDir }, onProgress) {
  const inExt = extOf(input);
  const suffix = `_增益_${db > 0 ? '+' : ''}${db}dB`;
  const output = buildOutputPath(input, suffix, inExt, outDir, customDir);

  if (inExt === 'mp3') {
    // mp3rgain：无损增益，调整每帧 global_gain，不重新编码。
    // 每个 step = 1.5051 dB，因此将请求的 dB 四舍五入到最近的 step。
    const STEP_DB = 1.5051;
    const steps = Math.round(db / STEP_DB);
    const actualDb = steps * STEP_DB;
    fs.copyFileSync(input, output);
    const args = ['-g', String(steps), '-k', '-p', '-s', 's', '-q', output];
    await run(MP3GAIN(), args);
    return {
      output,
      method: 'mp3gain-lossless',
      note: `MP3 无损增益：直接修改帧内 global_gain，不重新编码、音质零损失。请求 ${db}dB → 实际 ${actualDb.toFixed(1)}dB（约 1.5dB 步进，已防削波）。`,
    };
  }

  const codec = inExt === 'flac' ? 'flac'
    : (inExt === 'wav' ? 'pcm_s16le'
      : (inExt === 'aiff' || inExt === 'aif' ? 'pcm_s16be' : 'flac'));

  const args = [
    '-hide_banner', '-nostats', '-y',
    '-progress', 'pipe:1',
    '-i', input,
    '-map', '0:a:0',
    '-af', `volume=${db}dB`,
    '-c:a', codec,
    output,
  ];
  await run(FFMPEG(), args, { onProgress });
  return {
    output,
    method: 'lossless-reencode',
    note: '无损增益：FLAC/WAV 重编码仍为无损编码，音质零损失。',
  };
}

// 导出：剪切 + 增益 合并为一次操作。
// - MP3(源) -> MP3：真无损。剪切用 -c copy 帧对齐（绝不重编码），增益用 mp3rgain（不重编码）。
// - 其他 -> MP3：有损转换为 MP3（libmp3lame），剪切/增益/编码在同一趟完成。
// - 其他 -> FLAC/WAV/AIFF：无损（重编码仍为无损编码），剪切/增益在同一趟完成。
async function exportAudio({ input, start, end, db, format, outDir, customDir, isFull }, onProgress) {
  const inExt = extOf(input);
  const outExt = outputExt(input, format);
  const hasGain = Math.abs(db || 0) > 1e-6;
  const isCut = !isFull;
  const STEP_DB = 1.5051;

  const parts = [];
  if (isCut) parts.push(`剪切_${formatSeconds(start)}-${formatSeconds(end)}`);
  if (hasGain) parts.push(`增益_${db > 0 ? '+' : ''}${db}dB`);
  const suffix = parts.length ? '_' + parts.join('_') : '_转换';
  const output = buildOutputPath(input, suffix, outExt, outDir, customDir);

  const notes = [];

  // 源为 MP3 且输出 MP3：真无损。
  if (outExt === 'mp3' && inExt === 'mp3') {
    if (isCut) {
      await run(FFMPEG(), [
        '-hide_banner', '-nostats', '-y', '-progress', 'pipe:1',
        '-i', input,
        '-ss', formatSeconds(start),
        '-to', formatSeconds(end),
        '-map', '0:a:0',
        '-c', 'copy', '-avoid_negative_ts', 'make_zero',
        output,
      ], { onProgress });
      notes.push('MP3 无损剪切：按帧边界对齐（约 ' + (1152 / 44100 * 1000).toFixed(1) + 'ms 精度），不重新编码。');
    } else {
      fs.copyFileSync(input, output); // 整段：直接复制，避免帧对齐丢失任何样本
    }
    if (hasGain) {
      const steps = Math.round(db / STEP_DB);
      const actualDb = steps * STEP_DB;
      await run(MP3GAIN(), ['-g', String(steps), '-k', '-p', '-s', 's', '-q', output]);
      notes.push(`MP3 无损增益（不重编码）：请求 ${db}dB → 实际 ${actualDb.toFixed(1)}dB（约 1.5dB 步进，防削波）。`);
    }
    return { output, method: 'mp3-lossless', note: notes.join('　') };
  }

  // 其余情况：单趟 ffmpeg 完成剪切 + 增益 + 编码。
  const args = [
    '-hide_banner', '-nostats', '-y', '-progress', 'pipe:1',
    '-i', input,
    '-ss', formatSeconds(start),
    '-to', formatSeconds(end),
    '-map', '0:a:0',
  ];
  if (hasGain) args.push('-af', `volume=${db}dB`);

  if (outExt === 'mp3') {
    args.push('-c:a', 'libmp3lame', '-q:a', '2'); // 转换为 MP3（有损）
    notes.push('已转换为 MP3（VBR 约 190kbps，有损编码）。');
  } else if (outExt === 'flac') {
    args.push('-c:a', 'flac', '-compression_level', '5');
  } else if (outExt === 'wav') {
    args.push('-c:a', 'pcm_s16le');
  } else if (outExt === 'aiff' || outExt === 'aif') {
    args.push('-c:a', 'pcm_s16be');
  } else {
    args.push('-c', 'copy');
  }
  args.push(output);
  await run(FFMPEG(), args, { onProgress });

  if (outExt !== 'mp3') {
    if (isCut) notes.push('无损剪切：逐样本精确，无音质损失。');
    if (hasGain) notes.push('无损增益：重编码仍为无损编码，音质零损失。');
    if (!isCut && !hasGain) notes.push('已按目标格式转换（无损）。');
  } else if (isCut) {
    notes.push('已按选区剪切。');
  }
  return { output, method: outExt === 'mp3' ? 'mp3-convert' : 'lossless', note: notes.join('　') };
}

module.exports = {
  FFMPEG, FFPROBE, MP3GAIN,
  run, runRaw, formatSeconds, uniquePath, buildOutputPath, extOf,
  probe, decodePreview, cut, applyGain, exportAudio,
};
