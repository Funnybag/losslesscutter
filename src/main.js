import WaveSurfer from 'wavesurfer.js';
import Regions from 'wavesurfer.js/dist/plugins/regions.esm.js';
import Timeline from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import { VideoTool } from './video-tool.js';

const $ = (id) => document.getElementById(id);

let activeTool = 'audio';

const els = {
  btnOpen: $('btn-open'),
  fname: $('fname'), fmeta: $('fmeta'),
  btnPlay: $('btn-play'), btnStop: $('btn-stop'), playTime: $('play-time'),
  btnZoomOut: $('btn-zoom-out'), btnZoomIn: $('btn-zoom-in'), btnZoomFit: $('btn-zoom-fit'), zoomLabel: $('zoom-label'),
  waveArea: $('wave-area'), waveHint: $('wave-hint'), waveform: $('waveform'),
  playhead: $('playhead'), playheadGrab: $('playhead-grab'), gainBadge: $('gain-badge'),
  stepSelect: $('step-select'),
  inTime: $('in-time'), outTime: $('out-time'), selDur: $('sel-dur'),
  inSamples: $('in-samples'), outSamples: $('out-samples'), durNote: $('dur-note'),
  cutHint: $('cut-hint'), btnExport: $('btn-export'),
  nudgePrev: $('nudge-prev'), nudgeNext: $('nudge-next'),
  nudgePrevBig: $('nudge-prev-big'), nudgeNextBig: $('nudge-next-big'),
  btnSetIn: $('btn-set-in'), btnSetOut: $('btn-set-out'),
  gainSlider: $('gain-slider'), gainInput: $('gain-input'), gainHint: $('gain-hint'),
  formatSelect: $('format-select'), btnBrowse: $('btn-browse'),
  customDirRow: $('custom-dir-row'), customDirLabel: $('custom-dir-label'),
  statusText: $('status-text'), progressBar: $('progress-bar'),
};

let ws = null;
let regions = null;
let region = null;
let timeline = null;
let meta = null;
let filePath = null;
let duration = 0;
let pxPerSec = 20;
let isFit = true;
let currentTime = 0;
let currentOp = null;
let pointer = null; // { mode: 'pan'|'scrub', startX, startScroll, startTime, moved }
let liveGain = { ctx: null, node: null, done: false };
let gainRaf = null;
const settings = { outDir: 'same', customDir: '', format: 'same', sidebarCollapsed: false };

// 标签页状态（音频工具）
let tabs = [];               // [{ id, path, name, currentTime, start, end, gainDb }]
let activeTabId = null;
let pendingRestore = null;   // 切换/加载时恢复：{ start, end, currentTime, gainDb }
let loadSeq = 0;             // 防止快速切换标签页时旧加载覆盖新加载

const MP3_STEP_DB = 1.5051;

// ---------------- 极简统一图标 ----------------
const ICO = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICONS = {
  folder: ICO('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  scissors: ICO('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>'),
  volume: ICO('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'),
  settings: ICO('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.87l13-7.5a1 1 0 0 0 0-1.74l-13-7.5A1 1 0 0 0 7 4.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
  'step-back': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 4.5v15a1 1 0 0 1-1.6.8L9 13.3v6.2a1 1 0 0 1-1 1H6.6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1H8a1 1 0 0 1 1 1v6.2l8.4-7a1 1 0 0 1 1.6.8z"/></svg>',
  'step-fwd': '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4.5v15a1 1 0 0 0 1.6.8l8.4-7v6.2a1 1 0 0 0 1 1h1.4a1 1 0 0 0 1-1V4.5a1 1 0 0 0-1-1H16a1 1 0 0 0-1 1v6.2l-8.4-7A1 1 0 0 0 5 4.5z"/></svg>',
  'set-in': ICO('<path d="M4 4v16"/><path d="M4 4h5"/><path d="M4 20h5"/><path d="M14 8l5 4-5 4z" fill="currentColor" stroke="none"/>'),
  'set-out': ICO('<path d="M20 4v16"/><path d="M20 4h-5"/><path d="M20 20h-5"/><path d="M10 8l-5 4 5 4z" fill="currentColor" stroke="none"/>'),
  chevron: ICO('<polyline points="6 9 12 15 18 9"/>'),
  'zoom-in': ICO('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>'),
  'zoom-out': ICO('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>'),
  fit: ICO('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  'audio-wave': ICO('<path d="M2 12h2"/><path d="M6 8v8"/><path d="M10 4v16"/><path d="M14 8v8"/><path d="M18 12h4"/>'),
  film: ICO('<rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="8" x2="22" y2="8"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="16" x2="22" y2="16"/><line x1="8" y1="4" x2="8" y2="8"/><line x1="12" y1="12" x2="12" y2="16"/>'),
  'panel-left': ICO('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>'),
};

function applyIcons() {
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon] || ''; });
}
function setIcon(el, name) {
  el.querySelector('.ico').setAttribute('data-icon', name);
  el.querySelector('.ico').innerHTML = ICONS[name] || '';
}

function fmtTime(sec) {
  if (!Number.isFinite(sec)) sec = 0;
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s.toFixed(3), 6)}`;
}

function setStatus(msg, isErr = false) {
  els.statusText.textContent = msg;
  els.statusText.className = isErr ? 'err' : '';
}

function setProgress(p) {
  els.progressBar.style.width = (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%';
}

// ---------------- 工具切换（左侧边栏） ----------------
function switchTool(tool) {
  if (tool === activeTool) return;
  activeTool = tool;
  document.querySelectorAll('.tool-view').forEach((v) => { v.hidden = v.id !== 'tool-' + tool; });
  document.querySelectorAll('.tool-btn').forEach((b) => { b.classList.toggle('active', b.dataset.tool === tool); });
  setProgress(0);
  if (tool === 'audio') {
    VideoTool.pause();
    // 切回音频时校正波形尺寸与叠加层
    requestAnimationFrame(() => { if (isFit && duration) fitZoom(); else updateOverlays(); });
    setStatus('音频工具：请打开音频文件（MP3 / FLAC / WAV / AIFF）');
  } else if (tool === 'video') {
    if (ws && typeof ws.isPlaying === 'function' && ws.isPlaying()) ws.pause();
    VideoTool.onShown ? VideoTool.onShown() : null;
    setStatus('视频工具：请打开视频文件（MP4 / MKV / MOV 等），无损剪切按关键帧对齐');
  }
}

function setupSidebar() {
  document.querySelectorAll('.tool-btn').forEach((b) => {
    b.addEventListener('click', () => switchTool(b.dataset.tool));
  });
  const toggle = document.getElementById('sidebar-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      settings.sidebarCollapsed = !settings.sidebarCollapsed;
      applySidebarState();
      saveSettings();
    });
  }
}

function applySidebarState() {
  const app = document.querySelector('.app');
  if (app) app.classList.toggle('sidebar-collapsed', !!settings.sidebarCollapsed);
  const toggle = document.getElementById('sidebar-toggle');
  if (toggle) toggle.title = settings.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏';
}

// ---------------- 注入 shadow DOM 样式（滚动条暗色 + 选区体不拦截指针） ----------------
function injectShadowStyles() {
  const renderer = ws && ws.getRenderer && ws.getRenderer();
  const host = renderer && renderer.container;
  const root = host && host.shadowRoot;
  if (!root || root.querySelector('[data-ws-style]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-ws-style', '1');
  style.textContent = [
    '.scroll { scrollbar-width: thin; scrollbar-color: #3a4356 #1a1f2a; }',
    '.scroll::-webkit-scrollbar { height: 11px; width: 11px; }',
    '.scroll::-webkit-scrollbar-track { background: #1a1f2a; }',
    '.scroll::-webkit-scrollbar-thumb { background: #3a4356; border-radius: 6px; border: 2px solid #1a1f2a; }',
    '.scroll::-webkit-scrollbar-thumb:hover { background: #4a5470; }',
    '.scroll::-webkit-scrollbar-corner { background: #1a1f2a; }',
    '[part~="region"] { pointer-events: none !important; }',
    '[part~="region-handle-left"], [part~="region-handle-right"] { pointer-events: all !important; }',
  ].join('');
  root.appendChild(style);
}

// ---------------- Wavesurfer 初始化 ----------------
function setupWaveSurfer() {
  ws = WaveSurfer.create({
    container: els.waveform,
    height: 'auto',
    waveColor: '#4f8cff',
    progressColor: '#2f5aa8',
    cursorColor: 'transparent',
    cursorWidth: 1,
    barWidth: 1,
    barGap: 0,
    barRadius: 1,
    barHeight: 1,
    minPxPerSec: pxPerSec,
    normalize: false,
    dragToSeek: false,
    interact: true,
    hideScrollbar: false,
  });

  regions = Regions.create();
  ws.registerPlugin(regions);

  timeline = Timeline.create({
    container: '#timeline',
    height: 22,
    timeInterval: 1,
    primaryLabelInterval: 10,
    secondaryLabelInterval: 5,
    primaryLabelSpacing: 4,
    secondaryLabelSpacing: 4,
    style: { fontSize: '11px', color: '#9aa3b5' },
  });
  ws.registerPlugin(timeline);

  injectShadowStyles();

  const trackTime = (t) => { currentTime = t; els.playTime.textContent = fmtTime(t); updatePlayhead(); };
  ws.on('decode', (d) => {
    duration = (typeof d === 'number' && d > 0) ? d : (meta && meta.duration) || 0;
    onDecoded();
  });
  ws.on('timeupdate', trackTime);
  ws.on('seeking', trackTime);
  ws.on('interaction', trackTime);
  ws.on('scroll', () => updateOverlays());
  ws.on('zoom', () => updateOverlays());
  ws.on('redrawcomplete', () => updateOverlays());
  ws.on('play', () => { setIcon(els.btnPlay, 'pause'); resumeAudio(); });
  ws.on('pause', () => setIcon(els.btnPlay, 'play'));
  ws.on('finish', () => setIcon(els.btnPlay, 'play'));
  ws.on('error', (e) => { setStatus('加载失败：' + ((e && e.message) || e), true); });
}

function onDecoded() {
  if (!meta || !duration) return; // 清空视图/无文件时忽略（避免零长度选区）
  els.waveHint.style.display = 'none';
  currentTime = 0;
  createFullRegion();
  fitZoom();
  els.btnExport.disabled = false;
  setupLiveGain();
  // 恢复标签页保存的选区 / 增益 / 播放线位置
  if (pendingRestore) {
    const r = pendingRestore;
    pendingRestore = null;
    if (region) {
      const e = (r.end > 0) ? r.end : duration;
      const minLen = 1 / ((meta && meta.sampleRate) || 44100);
      const s = Math.max(0, Math.min(r.start || 0, e - minLen));
      region.setOptions({ start: s, end: Math.max(s + minLen, Math.min(e, duration)) });
    }
    if (r.gainDb) {
      els.gainSlider.value = r.gainDb;
      els.gainInput.value = r.gainDb;
      updateGainUI();
    }
    const t = Math.min(r.currentTime || 0, duration);
    currentTime = t;
    if (ws) ws.setTime(t);
    els.playTime.textContent = fmtTime(t);
    updatePlayhead();
  }
}

function createFullRegion() {
  regions.clearRegions();
  const sr = (meta && meta.sampleRate) || 44100;
  region = regions.addRegion({
    id: 'sel',
    start: 0,
    end: duration,
    drag: false,
    resize: true,
    color: 'rgba(88,155,255,0.16)',
    minLength: 1 / sr,
  });
  region.on('update', () => updateTimes());
  region.on('update-end', () => updateTimes());
  updateTimes();
}

// ---------------- 播放线 / 时间轴同步 ----------------
// 用 wavesurfer 自身渲染宽度计算像素位置，保证播放线与「已播放变暗」边界精确对齐。
function waveScrollWidth() {
  if (!ws) return duration * pxPerSec;
  const w = ws.getWrapper() && ws.getWrapper().scrollWidth;
  return w || (duration * pxPerSec);
}
function wavePps() {
  return duration > 0 ? waveScrollWidth() / duration : pxPerSec;
}

function updatePlayhead() {
  if (!ws || !duration) return;
  const t = ws.getCurrentTime();
  const d = ws.getDuration() || duration;
  const x = d > 0 ? (t / d) * waveScrollWidth() - ws.getScroll() : 0;
  els.playhead.style.transform = `translateX(${x}px)`;
}

// 时间轴在独立条带里，需随波形横向滚动同步平移。
function syncTimeline() {
  if (!ws || !timeline || !timeline.timelineWrapper) return;
  const sw = waveScrollWidth();
  const tw = timeline.timelineWrapper;
  if (sw > 0) tw.style.width = `${sw}px`;
  tw.style.transform = `translateX(${-ws.getScroll()}px)`;
}

function updateOverlays() {
  updatePlayhead();
  syncTimeline();
}

// ---------------- 选区 / 时间显示 ----------------
function updateTimes() {
  if (!region || !meta) return;
  const s = region.start, e = region.end;
  els.inTime.value = fmtTime(s);
  els.outTime.value = fmtTime(e);
  els.selDur.value = fmtTime(e - s);
  const sr = meta.sampleRate || 44100;
  els.inSamples.textContent = `采样 ${Math.round(s * sr)}`;
  els.outSamples.textContent = `采样 ${Math.round(e * sr)}`;
  els.durNote.textContent = `${Math.round((e - s) * sr)} 采样`;
  updateCutHint();
}

function updateCutHint() {
  if (!region || !meta) return;
  if (meta.codec === 'mp3') {
    const f = meta.mp3FrameSec || 1152 / (meta.sampleRate || 44100);
    const ss = Math.round(region.start / f) * f;
    const ee = Math.round(region.end / f) * f;
    els.cutHint.innerHTML =
      `MP3 无损剪切：按帧边界对齐（步进约 ${(f * 1000).toFixed(1)}ms），不重新编码。生效区间 <b>${fmtTime(ss)}</b> ~ <b>${fmtTime(ee)}</b>`;
    els.cutHint.className = 'hint mp3';
  } else {
    const acc = (1 / (meta.sampleRate || 44100) * 1000).toFixed(3);
    els.cutHint.innerHTML = `无损剪切：逐样本精确（精度 ${acc}ms），无音质损失。`;
    els.cutHint.className = 'hint ok';
  }
}

function snapRange(s, e) {
  if (!meta) return { start: s, end: e };
  if (meta.codec === 'mp3') {
    const f = meta.mp3FrameSec || 1152 / (meta.sampleRate || 44100);
    let ss = Math.max(0, Math.round(s / f) * f);
    let ee = Math.min(duration, Math.round(e / f) * f);
    if (ee - ss < f) ee = Math.min(duration, ss + f);
    return { start: ss, end: ee };
  }
  const sr = meta.sampleRate || 44100;
  return { start: Math.round(s * sr) / sr, end: Math.round(e * sr) / sr };
}

// ---------------- 缩放 ----------------
function updateZoomLabel() {
  els.zoomLabel.textContent = pxPerSec.toFixed(1) + ' px/s';
  els.zoomLabel.title = '每秒钟像素数（数值越大越放大）';
}

function setZoom(v) {
  const next = Math.max(1, Math.min(6000, v));
  const changed = next !== pxPerSec;
  pxPerSec = next;
  isFit = false;
  if (changed) ws.zoom(pxPerSec);
  updateZoomLabel();
  updateOverlays();
}

function fitZoom() {
  const w = els.waveform.clientWidth;
  if (!duration || !w) return;
  pxPerSec = Math.max(1, (w - 60) / duration);
  isFit = true;
  ws.zoom(pxPerSec);
  updateZoomLabel();
  updateOverlays();
}

// ---------------- 播放线定位 ----------------
function currentStepSec(big = false) {
  if (!meta) return 0.01;
  const v = els.stepSelect.value;
  let s;
  if (v === 'sample') s = 1 / (meta.sampleRate || 44100);
  else if (v === 'frame') s = meta.codec === 'mp3'
    ? (meta.mp3FrameSec || 1152 / (meta.sampleRate || 44100))
    : 1 / (meta.sampleRate || 44100);
  else s = parseFloat(v) || 0.01;
  return big ? s * 10 : s;
}

function seek(dir, big = false) {
  if (!ws || !duration) return;
  const step = currentStepSec(big);
  const t = Math.max(0, Math.min(duration, currentTime + dir * step));
  ws.setTime(t);
  currentTime = t;
  els.playTime.textContent = fmtTime(t);
  updatePlayhead();
}

function setInAtPlayhead() {
  if (!region || !ws) return;
  const minLen = 1 / ((meta && meta.sampleRate) || 44100);
  if (currentTime >= region.end - minLen / 2) { setStatus('播放线需位于出点之前', true); return; }
  region.setOptions({ start: currentTime, end: region.end });
  updateTimes();
}

function setOutAtPlayhead() {
  if (!region || !ws) return;
  const minLen = 1 / ((meta && meta.sampleRate) || 44100);
  if (currentTime <= region.start + minLen / 2) { setStatus('播放线需位于入点之后', true); return; }
  region.setOptions({ start: region.start, end: currentTime });
  updateTimes();
}

function selectAll() {
  if (!region || !duration) return;
  region.setOptions({ start: 0, end: duration });
  updateTimes();
}

// ---------------- 拖动：平移 / 拖动播放线 ----------------
function isOverRegionHandle(clientX) {
  if (!region || !ws || !duration) return false;
  const relX = clientX - els.waveform.getBoundingClientRect().left;
  const sw = waveScrollWidth();
  const sx = (region.start / duration) * sw - ws.getScroll();
  const ex = (region.end / duration) * sw - ws.getScroll();
  return Math.abs(relX - sx) < 9 || Math.abs(relX - ex) < 9;
}

function onPointerDown(e) {
  if (e.button !== 0 || !ws || !duration) return;
  if (e.target && e.target.closest && e.target.closest('#playhead-grab')) {
    pointer = { mode: 'scrub', startX: e.clientX, startTime: currentTime, moved: false };
    e.preventDefault();
  } else if (e.target && e.target.closest && e.target.closest('#waveform') && !isOverRegionHandle(e.clientX)) {
    pointer = { mode: 'pan', startX: e.clientX, startScroll: ws.getScroll(), moved: false };
  } else {
    pointer = null;
  }
}

function onPointerMove(e) {
  if (!pointer) return;
  const dx = e.clientX - pointer.startX;
  if (Math.abs(dx) > 3) pointer.moved = true;
  if (!pointer.moved) return;
  e.preventDefault();
  if (pointer.mode === 'scrub') {
    const t = Math.max(0, Math.min(duration, pointer.startTime + dx / wavePps()));
    ws.setTime(t);
    currentTime = t;
    els.playTime.textContent = fmtTime(t);
    updatePlayhead();
  } else {
    ws.setScroll(pointer.startScroll - dx);
    updateOverlays();
  }
}

function onPointerUp() {
  pointer = null;
}

// ---------------- 打开文件 ----------------
async function openFileDialog() {
  const p = await window.api.openFile();
  if (p) openInTab(p);
}

// ---------------- 标签页管理 ----------------
function renderTabs() {
  const bar = $('tabbar-audio');
  bar.innerHTML = '';
  tabs.forEach((t) => {
    const tab = document.createElement('div');
    tab.className = 'tab' + (t.id === activeTabId ? ' active' : '');
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = t.name;
    name.title = t.path;
    const close = document.createElement('span');
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = '关闭标签页';
    close.onclick = (e) => { e.stopPropagation(); closeTab(t.id); };
    tab.appendChild(name);
    tab.appendChild(close);
    tab.onclick = () => switchTab(t.id);
    bar.appendChild(tab);
  });
}

function saveActiveTabState() {
  const t = tabs.find((x) => x.id === activeTabId);
  if (!t) return;
  t.currentTime = currentTime;
  if (region) { t.start = region.start; t.end = region.end; }
  t.gainDb = parseFloat(els.gainInput.value) || 0;
}

function openInTab(p) {
  const existing = tabs.find((t) => t.path === p);
  if (existing) { switchTab(existing.id); return; }
  const t = {
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    path: p,
    name: p.split(/[\\/]/).pop(),
    currentTime: 0, start: 0, end: 0, gainDb: 0,
  };
  tabs.push(t);
  activeTabId = t.id;
  renderTabs();
  pendingRestore = { start: 0, end: 0, currentTime: 0, gainDb: 0 };
  loadFile(p);
}

function switchTab(id) {
  if (id === activeTabId) return;
  saveActiveTabState();
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  activeTabId = id;
  renderTabs();
  if (ws && typeof ws.isPlaying === 'function' && ws.isPlaying()) ws.pause();
  pendingRestore = { start: t.start, end: t.end, currentTime: t.currentTime, gainDb: t.gainDb };
  loadFile(t.path);
}

function closeTab(id) {
  const idx = tabs.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const wasActive = id === activeTabId;
  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    activeTabId = null;
    filePath = null; meta = null; duration = 0;
    clearAudioView();
    renderTabs();
    return;
  }
  if (wasActive) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    activeTabId = next.id;
    if (ws && typeof ws.isPlaying === 'function' && ws.isPlaying()) ws.pause();
    pendingRestore = { start: next.start, end: next.end, currentTime: next.currentTime, gainDb: next.gainDb };
    loadFile(next.path);
  }
  renderTabs();
}

function clearAudioView() {
  if (ws) { try { ws.empty(); } catch (e) {} }
  if (regions) regions.clearRegions();
  region = null;
  currentTime = 0;
  pxPerSec = 20;
  els.waveHint.style.display = 'flex';
  els.waveHint.textContent = '请打开一个音频文件开始编辑';
  els.fname.textContent = '未打开文件（也可直接拖入）';
  els.fmeta.textContent = '';
  els.btnExport.disabled = true;
  els.inTime.value = '00:00:00.000'; els.outTime.value = '00:00:00.000'; els.selDur.value = '00:00:00.000';
  els.inSamples.textContent = ''; els.outSamples.textContent = ''; els.durNote.textContent = '';
  els.cutHint.innerHTML = ''; els.cutHint.className = 'hint';
  els.playTime.textContent = '00:00:00.000';
  els.gainSlider.value = 0; els.gainInput.value = 0;
  els.gainBadge.hidden = true;
  els.gainHint.innerHTML = '导入文件后设置增益（MP3 无损 / FLAC·WAV 重编码无损）。';
  els.gainHint.className = 'hint ok';
  els.zoomLabel.textContent = '适配';
  applyLiveGain(0);
  applyVisualGain(0);
}

async function loadFile(p) {
  const mySeq = ++loadSeq;
  filePath = p;
  els.fname.textContent = p.split(/[\\/]/).pop();
  els.fmeta.textContent = '读取中…';
  els.waveHint.style.display = 'flex';
  els.waveHint.textContent = '正在解码并生成波形…';
  try {
    meta = await window.api.probe(p);
    if (mySeq !== loadSeq) return;
    const wavBytes = await window.api.decodePreview(p);
    if (mySeq !== loadSeq) return;
    const blob = new Blob([wavBytes], { type: 'audio/wav' });
    await ws.loadBlob(blob);
    if (mySeq !== loadSeq) return;

    const fmt = `${(meta.codec || '?').toUpperCase()} · ${((meta.sampleRate || 0) / 1000).toFixed(1)}kHz · ${meta.channels}声道 · ${Math.round((meta.bitRate || 0) / 1000)}kbps`;
    els.fmeta.textContent = `${fmt} · ${fmtTime(meta.duration)}`;
    updateGainHint();
    setStatus('已加载：' + filePath);
  } catch (e) {
    if (mySeq !== loadSeq) return;
    els.waveHint.style.display = 'flex';
    els.waveHint.textContent = '加载失败';
    setStatus('加载失败：' + (e && e.message ? e.message : e), true);
  }
}

// ---------------- 导出（剪切 + 增益合并） ----------------
function isFullRegion() {
  if (!region || !duration) return true;
  const sr = (meta && meta.sampleRate) || 44100;
  return region.start <= 1 / sr && region.end >= duration - 1 / sr;
}

async function doExport() {
  if (!region || !filePath) return;
  const db = parseFloat(els.gainInput.value) || 0;
  const full = isFullRegion();
  const converting = settings.format !== 'same';
  if (full && db === 0 && !converting) {
    setStatus('未做任何改动：请先设置选区或增益，或选择格式转换', true);
    return;
  }
  if (meta && meta.codec === 'mp3' && db !== 0 && Math.round(db / MP3_STEP_DB) === 0) {
    setStatus('MP3 无损增益最小步进约 1.5dB，请增大增益数值', true);
    return;
  }
  const snapped = snapRange(region.start, region.end);
  if (!full && snapped.end - snapped.start <= 0) { setStatus('选区为空，请拖动入点/出点或按 I/O 设置', true); return; }

  els.btnExport.disabled = true;
  currentOp = { type: 'export', duration };
  setStatus('正在导出…');
  setProgress(0);
  try {
    const res = await window.api.exportAudio({
      input: filePath,
      start: snapped.start,
      end: snapped.end,
      db,
      format: settings.format,
      outDir: settings.outDir,
      customDir: settings.customDir,
      isFull: full,
    });
    setProgress(1);
    setStatus('已保存：' + res.output + ' ｜ ' + res.note);
    if (window.confirm('导出完成！\n\n' + res.output + '\n\n是否在文件夹中显示该文件？')) {
      window.api.reveal(res.output);
    }
  } catch (e) {
    setStatus('导出失败：' + (e && e.message ? e.message : e), true);
  } finally {
    els.btnExport.disabled = false;
    currentOp = null;
  }
}

// ---------------- 增益（实时预览） ----------------
function updateGainUI() {
  const db = parseFloat(els.gainInput.value) || 0;
  const pct = ((db + 20) / 40) * 100;
  els.gainSlider.style.setProperty('--val', pct.toFixed(1) + '%');
  applyLiveGain(db);
  applyVisualGain(db);
  updateGainHint();
}

function applyLiveGain(db) {
  if (liveGain.node) liveGain.node.gain.value = Math.pow(10, (db || 0) / 20);
}

function applyVisualGain(db) {
  if (gainRaf) cancelAnimationFrame(gainRaf);
  gainRaf = requestAnimationFrame(() => {
    if (!ws) return;
    const g = Math.pow(10, (db || 0) / 20);
    ws.setOptions({ barHeight: g });
    const hasGain = Math.abs(db || 0) > 0.01;
    els.gainBadge.hidden = !hasGain;
    if (hasGain) {
      els.gainBadge.textContent = (db > 0 ? '+' : '') + db.toFixed(1) + ' dB';
      els.gainBadge.className = 'gain-badge' + (db < 0 ? ' cut' : '');
    }
  });
}

function updateGainHint() {
  const db = parseFloat(els.gainInput.value) || 0;
  if (meta && meta.codec === 'mp3') {
    const steps = Math.round(db / MP3_STEP_DB);
    const actual = steps * MP3_STEP_DB;
    els.gainHint.innerHTML = `MP3 无损增益（不重编码，步进约 1.5dB）：请求 ${db}dB → 实际 ${actual.toFixed(1)}dB（防削波）。`;
    els.gainHint.className = 'hint mp3';
  } else {
    els.gainHint.innerHTML = 'FLAC/WAV 无损增益：重编码仍为无损，导出时应用到选区。';
    els.gainHint.className = 'hint ok';
  }
}

function setupLiveGain() {
  if (liveGain.done || !ws) return;
  const el = ws.getMediaElement && ws.getMediaElement();
  if (!el) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    liveGain.ctx = liveGain.ctx || new AC();
    const src = liveGain.ctx.createMediaElementSource(el);
    liveGain.node = liveGain.ctx.createGain();
    src.connect(liveGain.node).connect(liveGain.ctx.destination);
    liveGain.done = true;
  } catch (e) { /* 已连接或环境不支持 */ }
}

function resumeAudio() {
  if (liveGain.ctx && liveGain.ctx.state === 'suspended') liveGain.ctx.resume();
}

// ---------------- 菜单栏 ----------------
function closeAllMenus() {
  document.querySelectorAll('.menu').forEach((m) => m.classList.remove('open'));
}

function runMenuAction(a) {
  switch (a) {
    case 'open':
      if (activeTool === 'video') VideoTool.openFileDialog();
      else openFileDialog();
      break;
    case 'open-merge':
      switchTool('video');
      VideoTool.openMergeDialog();
      break;
    case 'quit': if (window.api.quit) window.api.quit(); else window.close(); break;
    case 'select-all':
      if (activeTool === 'video') VideoTool.selectAll();
      else selectAll();
      break;
    case 'zoom-in':
      if (activeTool === 'video') VideoTool.zoomBy(0.7);
      else setZoom(pxPerSec * 1.5);
      break;
    case 'zoom-out':
      if (activeTool === 'video') VideoTool.zoomBy(1.4);
      else setZoom(pxPerSec / 1.5);
      break;
    case 'zoom-fit':
      if (activeTool === 'video') VideoTool.fitZoom();
      else fitZoom();
      break;
    case 'shortcuts': showShortcuts(); break;
  }
}

function showShortcuts() {
  const base =
    '空格：播放 / 暂停\n' +
    '← / →：播放线左右移动\n' +
    'I：以播放线设为入点\n' +
    'O：以播放线设为出点\n' +
    'Ctrl+O：打开文件\n' +
    'Ctrl+A：选择整段\n' +
    'Ctrl+Q：退出\n\n' +
    '滚轮：缩放时间轴\n' +
    'Alt+滚轮：左右平移\n';
  if (activeTool === 'video') {
    window.alert(
      '快捷键（视频工具）\n\n' + base +
      '拖动胶片条：平移视角\n' +
      '单击胶片条：定位播放线\n' +
      '拖动顶部红色抓手：拖动播放线\n' +
      '← / →：按「步长」移动（可设 1 帧或关键帧）\n\n' +
      '入点/出点自动吸附到最近关键帧，实现真正无损剪切。'
    );
  } else {
    window.alert(
      '快捷键（音频工具）\n\n' + base +
      '← / →：播放线左右移动（Shift 放大 10 倍）\n' +
      '拖动波形：平移视角\n' +
      '拖动顶部红线抓手：拖动播放线\n\n' +
      '入点/出点也可拖拽波形上的手柄调整。'
    );
  }
}

function setupMenu() {
  document.querySelectorAll('.menu').forEach((m) => {
    m.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = m.classList.contains('open');
      closeAllMenus();
      if (!wasOpen) m.classList.add('open');
    });
  });
  document.addEventListener('click', closeAllMenus);
  document.querySelectorAll('.menu-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      closeAllMenus();
      runMenuAction(action);
    });
  });
}

// ---------------- 设置 ----------------
function applySettingsUI() {
  const outdirRadio = document.querySelector(`input[name="outdir"][value="${settings.outDir}"]`);
  if (outdirRadio) outdirRadio.checked = true;
  els.formatSelect.value = settings.format || 'same';
  els.customDirLabel.textContent = settings.customDir || '（未选择）';
  toggleCustomDir();
  applySidebarState();
}

function toggleCustomDir() {
  els.customDirRow.hidden = settings.outDir !== 'custom';
}

async function loadSettings() {
  try {
    const s = await window.api.getSettings();
    if (s && typeof s === 'object') Object.assign(settings, s);
  } catch (e) { /* ignore */ }
  applySettingsUI();
}

function saveSettings() {
  window.api.setSettings({ ...settings });
}

// ---------------- 事件绑定 ----------------
function bindEvents() {
  els.btnOpen.onclick = openFileDialog;
  els.btnPlay.onclick = () => ws && ws.playPause();
  els.btnStop.onclick = () => ws && ws.stop();

  els.btnZoomIn.onclick = () => setZoom(pxPerSec * 1.5);
  els.btnZoomOut.onclick = () => setZoom(pxPerSec / 1.5);
  els.btnZoomFit.onclick = () => fitZoom();

  els.waveform.addEventListener('wheel', (e) => {
    if (!ws || !duration) return;
    e.preventDefault();
    if (e.altKey) {
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      ws.setScroll(ws.getScroll() + delta);
      updateOverlays();
    } else {
      const factor = e.deltaY < 0 ? 1.25 : 0.8;
      setZoom(pxPerSec * factor);
    }
  }, { passive: false });

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
  document.addEventListener('pointerdown', resumeAudio, { once: true });

  els.nudgePrev.onclick = () => seek(-1);
  els.nudgeNext.onclick = () => seek(1);
  els.nudgePrevBig.onclick = () => seek(-1, true);
  els.nudgeNextBig.onclick = () => seek(1, true);
  els.btnSetIn.onclick = setInAtPlayhead;
  els.btnSetOut.onclick = setOutAtPlayhead;

  els.gainSlider.oninput = () => { els.gainInput.value = els.gainSlider.value; updateGainUI(); };
  els.gainInput.oninput = () => { els.gainSlider.value = els.gainInput.value; updateGainUI(); };

  els.btnExport.onclick = doExport;

  document.querySelectorAll('input[name="outdir"]').forEach((r) => {
    r.onchange = () => { settings.outDir = r.value; toggleCustomDir(); saveSettings(); };
  });
  els.formatSelect.onchange = () => { settings.format = els.formatSelect.value; saveSettings(); };
  els.btnBrowse.onclick = async () => {
    const dir = await window.api.chooseFolder();
    if (dir) { settings.customDir = dir; els.customDirLabel.textContent = dir; saveSettings(); }
  };

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); runMenuAction('open'); return; }
    if (mod && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); runMenuAction('open-merge'); return; }
    if (mod && (e.key === 'q' || e.key === 'Q')) { e.preventDefault(); if (window.api.quit) window.api.quit(); else window.close(); return; }
    if (mod && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); runMenuAction('select-all'); return; }

    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (activeTool === 'video') {
      if (!VideoTool.hasFile()) return;
      const big = e.shiftKey;
      if (e.key === 'ArrowLeft') { e.preventDefault(); VideoTool.nudge(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); VideoTool.nudge(1); }
      else if (e.key === ' ') {
        // <video controls> 获得焦点时会自己处理空格（切换播放/暂停），
        // 这里若再切换一次就会“播一下又停”，故跳过交给原生处理。
        if (e.target && e.target.tagName === 'VIDEO') return;
        e.preventDefault();
        VideoTool.togglePlay();
      }
      else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); VideoTool.setIn(); }
      else if (e.key === 'o' || e.key === 'O') { e.preventDefault(); VideoTool.setOut(); }
      return;
    }

    if (!region) return;
    const big = e.shiftKey;
    if (e.key === 'ArrowLeft') { e.preventDefault(); seek(-1, big); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seek(1, big); }
    else if (e.key === ' ') { e.preventDefault(); if (ws) ws.playPause(); }
    else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); setInAtPlayhead(); }
    else if (e.key === 'o' || e.key === 'O') { e.preventDefault(); setOutAtPlayhead(); }
  });

  document.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files || !files.length) return;
    const paths = [];
    for (const f of files) {
      const p = window.api.pathForFile ? window.api.pathForFile(f) : (f.path || null);
      if (p) paths.push(p);
    }
    if (!paths.length) return;
    if (activeTool === 'video') {
      if (VideoTool.openInTab) VideoTool.openInTab(paths[0]); else VideoTool.loadFile(paths[0]);
    } else {
      openInTab(paths[0]);
    }
  });

  window.addEventListener('resize', () => { if (isFit && duration) fitZoom(); else updateOverlays(); });

  window.api.onProgress(({ type, value }) => {
    if (type === 'export' && currentOp) {
      const pct = currentOp.duration ? value / currentOp.duration : 0;
      setProgress(pct);
      setStatus(`正在处理… ${Math.round(pct * 100)}%`);
    } else if (type === 'vcut') {
      VideoTool.onProgress(value);
    }
  });
}

// ---------------- 启动 ----------------
applyIcons();
setupWaveSurfer();
setupMenu();
setupSidebar();
bindEvents();
loadSettings();
updateGainUI();

VideoTool.init({
  api: window.api,
  fmtTime,
  setStatus,
  setProgress,
  setIcon,
  ICONS,
});

setStatus('就绪。左侧可在「音频 / 视频」工具间切换；请打开或拖入文件开始编辑');
