'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const audio = require('./audio');

const FFMPEG = audio.FFMPEG;
const FFPROBE = audio.FFPROBE;
const { run, runRaw, formatSeconds, buildOutputPath } = audio;

function parseFps(rate) {
  if (!rate) return 0;
  const parts = String(rate).split('/');
  if (parts.length === 2 && parseFloat(parts[1]) > 0) {
    return parseFloat(parts[0]) / parseFloat(parts[1]);
  }
  return parseFloat(rate) || 0;
}

// 读取视频元信息。
async function probe(input) {
  const { stdout } = await run(FFPROBE(), [
    '-v', 'error',
    '-show_entries',
    'format=duration,size,format_name,bit_rate:stream=codec_name,codec_type,width,height,pix_fmt,profile,avg_frame_rate,r_frame_rate,duration,bit_rate,sample_rate,channels',
    '-of', 'json',
    input,
  ]);
  const data = JSON.parse(stdout);
  const streams = data.streams || [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const duration = parseFloat((data.format && data.format.duration) || (v && v.duration) || 0) || 0;
  return {
    duration,
    format: (data.format && data.format.format_name) || '',
    size: parseInt((data.format && data.format.size), 10) || 0,
    width: parseInt(v && v.width, 10) || 0,
    height: parseInt(v && v.height, 10) || 0,
    fps: parseFps(v && (v.avg_frame_rate || v.r_frame_rate)),
    videoCodec: (v && v.codec_name) || '',
    audioCodec: (a && a.codec_name) || '',
    pixFmt: (v && v.pix_fmt) || '',
    profile: (v && v.profile) || '',
    hasAudio: Boolean(a),
    sampleRate: parseInt(a && a.sample_rate, 10) || 0,
    channels: parseInt(a && a.channels, 10) || 0,
    bitRate: parseInt((data.format && data.format.bit_rate), 10) || 0,
  };
}

// 读取视频关键帧时间点（秒）。无损剪切必须按关键帧对齐。
async function getKeyframes(input) {
  const { stdout } = await run(FFPROBE(), [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_packets',
    '-show_entries', 'packet=pts_time,flags',
    '-of', 'csv=p=0',
    input,
  ]);
  const times = [];
  for (const line of stdout.split('\n')) {
    const i = line.indexOf(',');
    if (i < 0) continue;
    const flags = line.slice(i + 1).trim();
    if (!flags.startsWith('K')) continue; // 仅关键帧包
    const t = parseFloat(line.slice(0, i));
    if (Number.isFinite(t) && t >= 0) times.push(Math.round(t * 1000) / 1000);
  }
  return Array.from(new Set(times)).sort((x, y) => x - y);
}

// 生成胶片条（缩略图拼成一张横向长图），用于时间轴可视化。
// 内存缓存：同一文件 + 相同缩放级别（spt）+ 相同尺寸命中时，直接返回，避免重复解码（标签页切换 / 反复缩放时提速明显）。
const filmCache = new Map();
const FILM_CACHE_MAX = 40;

async function filmstrip(input, { spt = 2, thumbWidth = 128, thumbHeight = 72 } = {}) {
  let stat = null;
  try { stat = fs.statSync(input); } catch (e) { /* 忽略，走无缓存路径 */ }
  const cacheKey = stat
    ? `${input}|${stat.mtimeMs}|${stat.size}|${Math.round(spt * 100)}|${thumbWidth}|${thumbHeight}`
    : null;
  if (cacheKey && filmCache.has(cacheKey)) return filmCache.get(cacheKey);

  const info = await probe(input);
  const duration = info.duration || 1;
  const MAX_THUMBS = 240; // 限制缩略图数量，避免生成超大图片
  const MIN_SPT = 0.5;
  // 每张缩略图代表的秒数：不小于最小值，且保证总数不超过上限。
  let s = Math.max(spt, MIN_SPT, duration / MAX_THUMBS);
  const count = Math.max(1, Math.ceil(duration / s));
  s = duration / count;

  const buildArgs = (sVal, cnt) => [
    '-hide_banner', '-nostats', '-y',
    '-skip_frame', 'nokey', // 仅解码关键帧，避免逐帧全量解码导致 CPU 满载
    '-i', input,
    '-map', '0:v:0', // 只取视频流
    '-an', // 不解码音频，省 CPU
    '-vf',
    // fast_bilinear：快速缩放，对 2K / 高帧率视频更友好
    `fps=1/${sVal},scale=${thumbWidth}:${thumbHeight}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${thumbWidth}:${thumbHeight}:(ow-iw)/2:(oh-ih)/2:color=black,tile=${cnt}x1`,
    '-frames:v', '1',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    'pipe:1',
  ];

  let png;
  let usedS = s;
  let usedCount = count;
  try {
    png = await runRaw(FFMPEG(), buildArgs(s, count), { timeoutMs: 25000 });
  } catch (e) {
    // 2K / 120fps 等高清高帧率视频解码慢或失败时，降级重试一次：更少的缩略图（更快）。
    usedCount = Math.max(1, Math.ceil(count / 4));
    usedS = duration / usedCount;
    png = await runRaw(FFMPEG(), buildArgs(usedS, usedCount), { timeoutMs: 25000 });
    // 若降级仍失败，异常继续向上抛给渲染层（提示“生成缩略图失败”）。
  }

  const result = {
    png,
    spt: usedS,
    thumbWidth,
    thumbHeight,
    count: usedCount,
    duration,
    width: info.width,
    height: info.height,
  };

  if (cacheKey) {
    filmCache.set(cacheKey, result);
    while (filmCache.size > FILM_CACHE_MAX) {
      const first = filmCache.keys().next().value;
      filmCache.delete(first);
    }
  }
  return result;
}

// 音频编码器映射（重编码音频轨时使用与源相近的编码器）。
function audioEncoder(codec) {
  const map = {
    aac: 'aac',
    mp3: 'libmp3lame',
    opus: 'libopus',
    vorbis: 'libvorbis',
    ac3: 'ac3',
    eac3: 'eac3',
    pcm_s16le: 'pcm_s16le',
    pcm_s24le: 'pcm_s24le',
    flac: 'flac',
  };
  return map[codec] || 'aac';
}

// 无损剪切视频。
// 默认全部流复制（-c copy），不重新编码；start/end 需已按关键帧对齐（前端负责吸附）。
// 若传入 db（非 0）且存在音轨，则视频流仍复制（无损），音频轨按增益重编码。
async function cut({ input, start, end, outDir, customDir, db }, onProgress) {
  const ext = path.extname(input).slice(1).toLowerCase() || 'mp4';
  const gain = Number(db) || 0;
  const suffix = `_剪切_${formatSeconds(start)}-${formatSeconds(end)}${gain ? '_增益_' + (gain > 0 ? '+' : '') + gain.toFixed(1) + 'dB' : ''}`;
  const output = buildOutputPath(input, suffix, ext, outDir, customDir);

  let args;
  let note;
  if (gain !== 0) {
    const info = await probe(input);
    if (info.hasAudio) {
      const enc = audioEncoder(info.audioCodec);
      args = [
        '-hide_banner', '-nostats', '-y', '-progress', 'pipe:1',
        '-ss', formatSeconds(start),
        '-i', input,
        '-t', formatSeconds(end - start),
        '-map', '0:v:0', '-map', '0:a:0', '-map', '0:s?',
        '-c:v', 'copy',
        '-c:a', enc,
        '-c:s', 'copy',
        '-af', `volume=${gain.toFixed(2)}dB`,
        output,
      ];
      note = `视频流复制（无损）；音频轨按 ${gain > 0 ? '+' : ''}${gain.toFixed(1)}dB 重新编码（${enc}）。起止点按关键帧对齐。`;
    } else {
      args = copyArgs(input, start, end, output);
      note = '该视频无音轨，增益无效；视频流复制（无损），起止点按关键帧对齐。';
    }
  } else {
    args = copyArgs(input, start, end, output);
    note = '无损剪切：视频 / 音频 / 字幕全部流复制，不重新编码（起止点按关键帧对齐）。';
  }

  await run(FFMPEG(), args, { onProgress });
  return { output, note };
}

function copyArgs(input, start, end, output) {
  return [
    '-hide_banner', '-nostats', '-y', '-progress', 'pipe:1',
    '-ss', formatSeconds(start),
    '-i', input,
    '-t', formatSeconds(end - start),
    '-map', '0',
    '-c', 'copy',
    output,
  ];
}

// ---------------- 单帧缩略图（合并轨道片段预览用） ----------------
async function thumbnail(input, { width = 160, height = 90 } = {}) {
  return runRaw(FFMPEG(), [
    '-hide_banner', '-nostats', '-y',
    '-ss', '0.5', '-i', input, // 取约 0.5 秒处一帧（避开纯黑首帧）
    '-map', '0:v:0', '-an',
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    '-frames:v', '1',
    '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1',
  ], { timeoutMs: 8000 });
}

// ---------------- 合并视频 ----------------
// 判断所有片段编码/分辨率/帧率/像素格式/音频参数是否一致（一致则可无损流复制拼接）。
function isMergeCompatible(infos) {
  const first = infos[0];
  return infos.every((x) =>
    x.videoCodec === first.videoCodec &&
    x.pixFmt === first.pixFmt &&
    x.width === first.width &&
    x.height === first.height &&
    Math.abs(x.fps - first.fps) < 0.02 &&
    x.hasAudio === first.hasAudio &&
    x.audioCodec === first.audioCodec &&
    x.sampleRate === first.sampleRate &&
    x.channels === first.channels
  );
}

// 合并到指定输出文件（内部实现）。返回 { lossless } 表示是否无损流复制。
async function mergeToFile(inputs, outputFile, onProgress) {
  const infos = [];
  for (const input of inputs) infos.push(await probe(input));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcc-merge-'));
  const files = [];
  try {
    if (isMergeCompatible(infos)) {
      // 无损路径：先统一重封装为 mkv（规范化时间戳/容器），再 concat 流复制。
      for (let i = 0; i < inputs.length; i++) {
        const f = path.join(tmp, `p${i}.mkv`);
        await run(FFMPEG(), ['-hide_banner', '-nostats', '-y', '-i', inputs[i], '-map', '0', '-c', 'copy', '-f', 'matroska', f]);
        files.push(f);
      }
      const list = path.join(tmp, 'list.txt');
      fs.writeFileSync(list, files.map((x) => `file '${x}'`).join('\n'));
      await run(FFMPEG(), [
        '-hide_banner', '-nostats', '-y', '-progress', 'pipe:1',
        '-f', 'concat', '-safe', '0', '-i', list,
        '-c', 'copy',
        outputFile,
      ], { onProgress });
      return { lossless: true };
    }

    // 有损路径：逐片段重编码为统一格式（H.264/AAC，对齐首个片段的分辨率与帧率），再无损拼接。
    const first = infos[0];
    const tw = first.width || 1280;
    const th = first.height || 720;
    const tfps = first.fps || 30;
    const hasAnyAudio = infos.some((x) => x.hasAudio);

    for (let i = 0; i < inputs.length; i++) {
      const info = infos[i];
      const f = path.join(tmp, `p${i}.mkv`);
      const args = [
        '-hide_banner', '-nostats', '-y', '-i', inputs[i],
        '-map', '0:v:0',
        '-vf', `scale=${tw}:${th}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black`,
        '-r', String(tfps),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      ];
      if (hasAnyAudio) {
        if (info.hasAudio) {
          args.push('-map', '0:a:0', '-c:a', 'aac', '-ar', '48000', '-ac', '2');
        } else {
          // 无音频片段补充静音轨，保证所有片段流布局一致。
          args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
          args.push('-map', '1:a:0', '-c:a', 'aac', '-shortest');
        }
      } else {
        args.push('-an');
      }
      args.push('-f', 'matroska', f);
      await run(FFMPEG(), args);
      files.push(f);
      if (onProgress) onProgress(i / inputs.length * 0.8);
    }
    const list = path.join(tmp, 'list.txt');
    fs.writeFileSync(list, files.map((x) => `file '${x}'`).join('\n'));
    await run(FFMPEG(), [
      '-hide_banner', '-nostats', '-y', '-progress', 'pipe:1',
      '-f', 'concat', '-safe', '0', '-i', list,
      '-c', 'copy',
      outputFile,
    ], { onProgress: (p) => { if (onProgress) onProgress(0.8 + p * 0.2); } });
    return { lossless: false };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 独立合并导出（保留接口）。
async function mergeVideos({ inputs, outDir, customDir }, onProgress) {
  if (!Array.isArray(inputs) || inputs.length < 2) {
    throw new Error('至少需要 2 个视频才能合并');
  }
  const ext = path.extname(inputs[0]).slice(1).toLowerCase() || 'mp4';
  const output = buildOutputPath(inputs[0], '_合并', ext, outDir, customDir);
  const { lossless } = await mergeToFile(inputs, output, onProgress);
  return {
    output,
    note: lossless
      ? '无损合并：所有片段编码一致，已流复制拼接，无画质损失。'
      : '合并完成：片段格式不一致，已统一重编码（H.264/AAC，对齐首个片段分辨率与帧率）后拼接。',
  };
}

// 剪切单个片段（用于合并剪切）。compatible 时视频流复制；否则重编码规范化为统一格式。
// db 非 0 且片段有音轨时，音频轨按增益重编码。
async function cutPiece({ input, info, localStart, localEnd, compatible, first, hasAnyAudio, db, outFile }) {
  const gain = Number(db) || 0;
  const dur = localEnd - localStart;

  if (compatible && gain === 0) {
    await run(FFMPEG(), copyArgs(input, localStart, localEnd, outFile));
    return;
  }

  const args = [
    '-hide_banner', '-nostats', '-y',
    '-ss', formatSeconds(localStart), '-i', input,
    '-t', formatSeconds(dur),
    '-map', '0:v:0',
  ];

  if (compatible) {
    args.push('-c:v', 'copy');
  } else {
    const tw = first.width || 1280, th = first.height || 720, tfps = first.fps || 30;
    args.push(
      '-vf', `scale=${tw}:${th}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black`,
      '-r', String(tfps),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'
    );
  }

  const needSilent = !compatible && hasAnyAudio; // 不兼容且整体有音频：无音轨片段补静音轨
  if (info.hasAudio) {
    args.push('-map', '0:a:0');
    if (compatible) {
      if (gain !== 0) args.push('-c:a', audioEncoder(info.audioCodec), '-af', `volume=${gain.toFixed(2)}dB`);
      else args.push('-c:a', 'copy');
    } else {
      args.push('-c:a', 'aac', '-ar', '48000', '-ac', '2');
      if (gain !== 0) args.push('-af', `volume=${gain.toFixed(2)}dB`);
    }
  } else if (needSilent) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    args.push('-map', '1:a:0', '-c:a', 'aac', '-ar', '48000', '-ac', '2');
    if (gain !== 0) args.push('-af', `volume=${gain.toFixed(2)}dB`);
  } else {
    args.push('-an');
  }

  args.push('-map', '0:s?', '-c:s', 'copy', '-f', 'matroska', outFile);
  await run(FFMPEG(), args);
}

// 合并 + 剪切：按合并时间轴计算每个片段与选区 [start, end] 的重叠区间，
// 逐段剪切（编码一致时无损流复制，否则统一重编码），再把各段按顺序拼接。
// 单一片段时直接走剪切。
async function mergeAndCut({ inputs, start, end, outDir, customDir, db }, onProgress) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error('没有可导出的视频片段');
  }
  if (inputs.length === 1) {
    return cut({ input: inputs[0], start, end, outDir, customDir, db }, onProgress);
  }

  const gain = Number(db) || 0;
  const ext = path.extname(inputs[0]).slice(1).toLowerCase() || 'mp4';
  const suffix = `_合并剪切_${formatSeconds(start)}-${formatSeconds(end)}${gain ? '_增益_' + (gain > 0 ? '+' : '') + gain.toFixed(1) + 'dB' : ''}`;
  const output = buildOutputPath(inputs[0], suffix, ext, outDir, customDir);

  const infos = [];
  for (const input of inputs) infos.push(await probe(input));
  const compatible = isMergeCompatible(infos);
  const first = infos[0];
  const hasAnyAudio = infos.some((x) => x.hasAudio);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcc-mergecut-'));
  try {
    const pieces = [];
    let acc = 0;
    for (let i = 0; i < inputs.length; i++) {
      const dur = infos[i].duration || 0;
      const cs = acc;
      const ce = acc + dur;
      acc = ce;
      const s = Math.max(start, cs);
      const e = Math.min(end, ce);
      if (e - s <= 0.001) continue;
      const piece = path.join(tmp, `piece${i}.mkv`);
      await cutPiece({
        input: inputs[i], info: infos[i],
        localStart: s - cs, localEnd: e - cs,
        compatible, first, hasAnyAudio, db: gain, outFile: piece,
      });
      pieces.push(piece);
      if (onProgress) onProgress(i / inputs.length * 0.75);
    }
    if (!pieces.length) throw new Error('选区与任何片段都不重叠');

    const list = path.join(tmp, 'list.txt');
    fs.writeFileSync(list, pieces.map((x) => `file '${x}'`).join('\n'));
    await run(FFMPEG(), [
      '-hide_banner', '-nostats', '-y', '-progress', 'pipe:1',
      '-f', 'concat', '-safe', '0', '-i', list,
      '-c', 'copy',
      output,
    ], { onProgress: (p) => { if (onProgress) onProgress(0.75 + p * 0.25); } });

    const note = (compatible ? '无损合并' : '统一重编码合并') + '并剪切'
      + (gain !== 0 ? `；音频轨 ${gain > 0 ? '+' : ''}${gain.toFixed(1)}dB` : '')
      + '（起止点按关键帧对齐）。';
    return { output, note };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 合并预览：把多个片段合并到一个临时 mp4，返回其路径供 <video> 播放预览。
// 单片段直接返回原路径；生成新预览前删除旧预览，避免临时文件堆积。
let lastMergePreview = null;
async function mergePreview({ inputs }) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error('没有可预览的片段');
  }
  if (inputs.length === 1) return inputs[0];
  if (lastMergePreview) { try { fs.rmSync(lastMergePreview, { force: true }); } catch (e) {} }
  const tmp = path.join(os.tmpdir(), `lcc-preview-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp4`);
  await mergeToFile(inputs, tmp);
  lastMergePreview = tmp;
  return tmp;
}

module.exports = { probe, getKeyframes, filmstrip, cut, thumbnail, mergeVideos, mergeAndCut, mergePreview };
