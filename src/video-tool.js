// 视频无损剪切工具（胶片时间轴 + 关键帧对齐 + 流复制导出）

let api, fmtTime, setStatus, setProgress, setIcon, ICONS;
let els = {};
let filePath = null;
let meta = null;          // probe 结果
let keyframes = [];       // 关键帧时间点（秒）
let film = null;          // { spt, thumbWidth, count, pngUrl, thumbHeight, width, height }
let duration = 0;
let currentTime = 0;
let start = 0;
let end = 0;
let requestSpt = 2;       // 每张缩略图代表的秒数（越小越放大）
let isFit = true;
let pointer = null;       // { mode: 'pan'|'scrub', startX, startScroll, startTime, moved }
let busy = false;
let filmstripSeq = 0;     // 防止标签页切换时旧的胶片图结果覆盖新的
let ready = false;        // 视频是否已完全就绪（信息 + 胶片条 + 定位完成），就绪前禁止播放

// 音量增益（实时预览）
let vGain = { ctx: null, node: null, done: false };
// 标签页状态
let tabs = [];            // [{ id, path, name, start, end, currentTime, gainDb, spt, fit }]
let activeTabId = null;
let pendingRestore = null;

const THUMB_WIDTH = 128;
const THUMB_HEIGHT = 72;
const settings = { outDir: 'same', customDir: '' };

// 合并轨道片段缩略图（胶片条）：宽度 / 高度 / 每帧最小像素密度
const MERGE_TW = 120;
const MERGE_TH = 72;
const MERGE_MIN_PPS = 6; // 至少 6px/秒，长片可横向滚动

// 合并模式：多个片段拼成一条时间轴，再按入/出点剪切导出
let mergeClips = [];     // [{ id, path, name, duration, width, height, fps, videoCodec, audioCodec, hasAudio, filmUrl, filmW }]
let mergeMode = false;
let mergeDrag = null;    // { id, startX, startY, moved, wasReorder }
let mergeSeq = 0;
let mergePreviewPath = null; // 合并后的临时预览文件路径（供播放）
let mergeSpt = 0;            // 当前统一使用的胶片条密度（秒/帧），用于判断是否需要重新生成

const $ = (id) => document.getElementById(id);

function pxPerSec() {
  return film ? film.thumbWidth / film.spt : 0;
}
function xAt(t) {
  return t * pxPerSec();
}
function clampT(t) {
  return Math.max(0, Math.min(duration, t));
}
function mediaUrl(p) {
  // 用 file:// 直链播放（配合主进程 webSecurity:false），pathToFileURL 会自动处理空格/中文/# 等特殊字符。
  return (api.fileUrl ? api.fileUrl(p) : ('file:///' + encodeURI(p.replace(/\\/g, '/'))));
}

// 吸附到最近关键帧
function snapKey(t) {
  if (mergeMode) return mergeSnap(t); // 合并模式下吸附到片段边界
  if (!keyframes.length) return Math.round(t * 1000) / 1000;
  let best = keyframes[0];
  let bestDiff = Infinity;
  for (const kf of keyframes) {
    const d = Math.abs(kf - t);
    if (d < bestDiff) { bestDiff = d; best = kf; }
  }
  return best;
}

// ---------------- 渲染 ----------------
function updatePlayhead() {
  if (!film || !els.vPlayhead) return;
  const x = xAt(currentTime) - els.filmstripScroll.scrollLeft;
  els.vPlayhead.style.transform = `translateX(${x}px)`;
  els.playTime.textContent = fmtTime(currentTime);
}

function updateRegion() {
  if (!film || !els.vRegion) return;
  const r = els.vRegion;
  if (end - start <= 0) { r.style.display = 'none'; return; }
  r.style.display = 'block';
  r.style.left = xAt(start) + 'px';
  r.style.width = (xAt(end) - xAt(start)) + 'px';
}

function renderKeys() {
  els.vKeys.innerHTML = '';
  if (!film) return;
  const frag = document.createDocumentFragment();
  for (const kf of keyframes) {
    const d = document.createElement('div');
    d.className = 'v-key';
    d.style.left = xAt(kf) + 'px';
    d.title = '关键帧 ' + fmtTime(kf);
    frag.appendChild(d);
  }
  els.vKeys.appendChild(frag);
}

// 时间标尺：选择「好看」的刻度间隔
function niceStep(targetSec) {
  if (targetSec <= 0) targetSec = 1;
  const pow = Math.pow(10, Math.floor(Math.log10(targetSec)));
  const n = targetSec / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function renderRuler() {
  els.vRuler.innerHTML = '';
  if (!film || !duration) return;
  const pps = pxPerSec();
  const step = niceStep(90 / pps); // 目标 ~90px 一个刻度
  const frag = document.createDocumentFragment();
  for (let t = 0; t <= duration + step; t += step) {
    const tick = document.createElement('div');
    tick.className = 'r-tick';
    tick.style.left = xAt(t) + 'px';
    frag.appendChild(tick);
    const label = document.createElement('div');
    label.className = 'r-label';
    label.style.left = xAt(t) + 'px';
    label.textContent = fmtTime(t).replace(/\.\d{3}$/, '').replace(/^0+(\d):/, '$1:');
    frag.appendChild(label);
  }
  els.vRuler.appendChild(frag);
}

function updateTimes() {
  els.vInTime.value = fmtTime(start);
  els.vOutTime.value = fmtTime(end);
  els.vSelDur.value = fmtTime(end - start);
  if (mergeMode) updateMergeRegion();
  else updateRegion();
}

function updateZoomLabel() {
  els.vZoomLabel.textContent = film ? film.spt.toFixed(2) + ' s/图' : '适配';
}

// ---------------- 胶片条生成 ----------------
async function regenFilmstrip() {
  if (!filePath) return;
  const mySeq = ++filmstripSeq;
  busy = true;
  setStatus('正在生成时间轴缩略图…');
  try {
    const f = await api.filmstrip(filePath, { spt: requestSpt, thumbWidth: THUMB_WIDTH, thumbHeight: THUMB_HEIGHT });
    if (mySeq !== filmstripSeq) return; // 结果已过期（标签页切换 / 期间又有新的缩放）
    const blob = new Blob([f.png], { type: 'image/png' });
    if (film && film.pngUrl) URL.revokeObjectURL(film.pngUrl);
    f.pngUrl = URL.createObjectURL(blob);
    film = f;
    els.filmstripImg.src = f.pngUrl;
    els.filmstripImg.style.width = (f.count * f.thumbWidth) + 'px'; // 去掉缩放时的临时拉伸，恢复清晰宽度
    els.filmstripTrack.style.width = (f.count * f.thumbWidth) + 'px';
    renderRuler();
    renderKeys();
    updateRegion();
    updatePlayhead();
    updateZoomLabel();
  } catch (e) {
    if (mySeq === filmstripSeq) setStatus('生成缩略图失败：' + (e && e.message ? e.message : e), true);
  } finally {
    if (mySeq === filmstripSeq) {
      busy = false;
      setStatus('已加载：' + filePath);
    }
  }
}

// ---------------- 缩放 ----------------
let regenTimer = null;

// 复现 electron filmstrip 的布局算法，保证“即时缩放”宽度与最终清晰图一致。
function filmstripLayout(spt) {
  const MAX_THUMBS = 240;
  const MIN_SPT = 0.5;
  const s = Math.max(spt, MIN_SPT, duration / MAX_THUMBS);
  const count = Math.max(1, Math.ceil(duration / s));
  return { spt: duration / count, count };
}

// 立即应用缩放：横向拉伸/压缩现有缩略图，马上反映缩放；停止操作 350ms 后再异步生成清晰缩略图。
function applyZoomLayout() {
  if (!duration) return;
  const layout = filmstripLayout(requestSpt);
  filmstripSeq++; // 令进行中的旧 regen 结果失效，避免它覆盖新的即时布局
  if (film) { film.spt = layout.spt; film.count = layout.count; }
  const w = layout.count * THUMB_WIDTH;
  els.filmstripTrack.style.width = w + 'px';
  els.filmstripImg.style.width = w + 'px';
  renderRuler();
  renderKeys();
  updateRegion();
  updatePlayhead();
  updateZoomLabel();
  if (regenTimer) clearTimeout(regenTimer);
  regenTimer = setTimeout(() => { regenTimer = null; regenFilmstrip(); }, 350);
}

function setSpt(spt, fit) {
  requestSpt = Math.max(0.5, Math.min(300, spt));
  isFit = Boolean(fit);
  applyZoomLayout();
}
function fitZoom() {
  const w = els.filmstripScroll.clientWidth;
  if (!duration || !w) return;
  requestSpt = Math.max(0.5, (duration * THUMB_WIDTH) / w);
  isFit = true;
  applyZoomLayout();
}
function zoomBy(factor) {
  isFit = false;
  setSpt(requestSpt * factor, false);
}
let lastWheelZoomAt = 0;

// ---------------- 播放线定位 ----------------
function stepSec() {
  if (!meta) return 1;
  const v = els.vStepSelect.value;
  if (v === 'frame') return 1 / (meta.fps || 30);
  if (v === 'keyframe') return 0; // 特殊：跳关键帧
  return parseFloat(v) || 1;
}

function seekTo(t) {
  currentTime = clampT(t);
  if (mergeMode) updateMergePlayhead();
  else updatePlayhead();
  try { if (els.videoEl && duration) els.videoEl.currentTime = currentTime; } catch (e) {}
}

function nudge(dir) {
  if (!duration) return;
  const v = els.vStepSelect.value;
  const list = mergeMode ? mergeBoundaries() : keyframes;
  if (v === 'keyframe') {
    if (dir < 0) {
      const prev = list.filter((k) => k < currentTime - 0.001);
      seekTo(prev.length ? prev[prev.length - 1] : 0);
    } else {
      const next = list.find((k) => k > currentTime + 0.001);
      seekTo(next != null ? next : duration);
    }
  } else {
    seekTo(currentTime + dir * stepSec());
  }
}

function setIn() {
  if (!duration) return;
  const k = snapKey(currentTime);
  if (k >= end) { setStatus('入点需位于出点之前', true); return; }
  start = k;
  updateTimes();
}
function setOut() {
  if (!duration) return;
  const k = snapKey(currentTime);
  if (k <= start) { setStatus('出点需位于入点之后', true); return; }
  end = k;
  updateTimes();
}
function selectAll() {
  if (!duration) return;
  start = 0;
  end = duration;
  updateTimes();
}

// ---------------- 拖动：平移 / 拖动播放线 ----------------
function onPointerDown(e) {
  if (e.button !== 0 || !film || !duration) return;
  if (e.target && e.target.closest && e.target.closest('#v-playhead-grab')) {
    pointer = { mode: 'scrub', startX: e.clientX, startTime: currentTime, moved: false };
    e.preventDefault();
  } else if (e.target && e.target.closest && e.target.closest('#filmstrip-scroll')) {
    pointer = { mode: 'pan', startX: e.clientX, startScroll: els.filmstripScroll.scrollLeft, moved: false };
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
    seekTo(clampT(pointer.startTime + dx / pxPerSec()));
  } else {
    els.filmstripScroll.scrollLeft = pointer.startScroll - dx;
    updatePlayhead();
  }
}

function onPointerUp(e) {
  if (pointer && !pointer.moved && pointer.mode === 'pan') {
    // 单击 = 定位播放线
    const rect = els.filmstripScroll.getBoundingClientRect();
    const t = (els.filmstripScroll.scrollLeft + (e.clientX - rect.left)) / pxPerSec();
    seekTo(clampT(t));
  }
  pointer = null;
}

// ---------------- 音量增益（实时预览） ----------------
function pause() {
  if (els.videoEl && !els.videoEl.paused) els.videoEl.pause();
}

function setupLiveGain() {
  if (vGain.done || !els.videoEl) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    vGain.ctx = vGain.ctx || new AC();
    const src = vGain.ctx.createMediaElementSource(els.videoEl);
    vGain.node = vGain.ctx.createGain();
    src.connect(vGain.node).connect(vGain.ctx.destination);
    vGain.done = true;
  } catch (e) { /* 已连接或环境不支持 */ }
}

function resumeGain() {
  if (vGain.ctx && vGain.ctx.state === 'suspended') vGain.ctx.resume();
}

function applyLiveGain(db) {
  if (vGain.node) vGain.node.gain.value = Math.pow(10, (db || 0) / 20);
}

function updateGainUI() {
  const db = parseFloat(els.vGainInput.value) || 0;
  const pct = ((db + 20) / 40) * 100;
  els.vGainSlider.style.setProperty('--val', pct.toFixed(1) + '%');
  applyLiveGain(db);
  const hasGain = Math.abs(db) > 0.01;
  els.vBadge.hidden = !hasGain;
  if (hasGain) {
    els.vBadge.textContent = (db > 0 ? '+' : '') + db.toFixed(1) + ' dB';
    els.vBadge.className = 'gain-badge v-badge' + (db < 0 ? ' cut' : '');
  }
  updateGainHint(db);
}

function updateGainHint(db) {
  if (Math.abs(db || 0) < 0.01) {
    els.vGainHint.innerHTML = '0 dB 表示不改变；增益仅在导出时应用到音频轨。';
    els.vGainHint.className = 'hint ok';
  } else {
    els.vGainHint.innerHTML = `导出时音频轨按 <b>${(db > 0 ? '+' : '') + db.toFixed(1)}dB</b> 重编码，视频保持无损复制。`;
    els.vGainHint.className = 'hint ok';
  }
}

// ---------------- 标签页管理 ----------------
function renderTabs() {
  const bar = $('tabbar-video');
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
  if (mergeMode) return; // 合并模式下不覆盖标签页保存的选区
  const t = tabs.find((x) => x.id === activeTabId);
  if (!t) return;
  t.start = start;
  t.end = end;
  t.currentTime = currentTime;
  t.gainDb = parseFloat(els.vGainInput.value) || 0;
  t.spt = requestSpt;
  t.fit = isFit;
}

function openInTab(p) {
  const existing = tabs.find((t) => t.path === p);
  if (existing) { switchTab(existing.id); return; }
  const t = {
    id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    path: p,
    name: p.split(/[\\/]/).pop(),
    start: 0, end: 0, currentTime: 0, gainDb: 0, spt: 2, fit: true,
  };
  tabs.push(t);
  activeTabId = t.id;
  renderTabs();
  pendingRestore = { start: 0, end: 0, currentTime: 0, gainDb: 0, spt: 2, fit: true };
  loadFile(p);
}

function switchTab(id) {
  if (id === activeTabId) return;
  saveActiveTabState();
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  activeTabId = id;
  renderTabs();
  pause();
  pendingRestore = { start: t.start, end: t.end, currentTime: t.currentTime, gainDb: t.gainDb, spt: t.spt, fit: t.fit };
  loadFile(t.path);
}

function closeTab(id) {
  const idx = tabs.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const wasActive = id === activeTabId;
  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    activeTabId = null;
    filePath = null; meta = null; duration = 0; keyframes = [];
    clearVideoView();
    renderTabs();
    return;
  }
  if (wasActive) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    activeTabId = next.id;
    pause();
    pendingRestore = { start: next.start, end: next.end, currentTime: next.currentTime, gainDb: next.gainDb, spt: next.spt, fit: next.fit };
    loadFile(next.path);
  }
  renderTabs();
}

function clearVideoView() {
  pause();
  ready = false;
  exitMergeMode();
  filmstripSeq++; // 使进行中的旧 regen 结果失效
  if (regenTimer) { clearTimeout(regenTimer); regenTimer = null; }
  els.btnPlay.disabled = true;
  if (film && film.pngUrl) { URL.revokeObjectURL(film.pngUrl); film = null; }
  els.videoEl.removeAttribute('src');
  try { els.videoEl.load(); } catch (e) {}
  els.videoHint.style.display = 'flex';
  els.videoHint.textContent = '请打开一个视频文件开始编辑（支持拖入）';
  els.vFname.textContent = '未打开文件（也可直接拖入）';
  els.vFmeta.textContent = '';
  els.vBtnExport.disabled = true;
  els.vInTime.value = '00:00:00.000'; els.vOutTime.value = '00:00:00.000'; els.vSelDur.value = '00:00:00.000';
  els.vInfo.innerHTML = '（未打开文件）';
  els.playTime.textContent = '00:00:00.000';
  els.vGainSlider.value = 0; els.vGainInput.value = 0;
  els.vBadge.hidden = true;
  els.vGainHint.innerHTML = '导入视频后设置音量增益（导出时仅重编码音频轨）。';
  els.vGainHint.className = 'hint ok';
  els.filmstripImg.removeAttribute('src');
  els.filmstripTrack.style.width = '0px';
  els.vRuler.innerHTML = ''; els.vKeys.innerHTML = '';
  els.vRegion.style.display = 'none';
  els.vZoomLabel.textContent = '适配';
  applyLiveGain(0);
}

// ---------------- 打开文件 ----------------
async function openFileDialog() {
  const p = await api.openVideo();
  if (p) openInTab(p);
}

// 清空当前胶片条（切换/加载文件时调用，避免旧缩略图残留或覆盖新文件）
function clearFilm() {
  filmstripSeq++; // 使进行中的旧 regen 结果失效
  if (film && film.pngUrl) { URL.revokeObjectURL(film.pngUrl); film = null; }
  els.filmstripImg.removeAttribute('src');
  els.filmstripImg.style.width = '';
  els.filmstripTrack.style.width = '0px';
  els.vRuler.innerHTML = '';
  els.vKeys.innerHTML = '';
  els.vRegion.style.display = 'none';
  els.vZoomLabel.textContent = '适配';
}

// ---------------- 合并模式（片段轨道 + 合并剪切） ----------------
function mergeDuration() {
  return mergeClips.reduce((s, c) => s + (c.duration || 0), 0);
}
function mergeTrackWidth() {
  return (els.videoArea && els.videoArea.clientWidth) || (els.mergeScroll && els.mergeScroll.clientWidth) || 0;
}
function mergePps() {
  const w = mergeTrackWidth();
  const d = mergeDuration();
  if (!w || !d) return MERGE_MIN_PPS;
  return Math.max(w / d, MERGE_MIN_PPS); // 至少 6px/秒，必要时横向滚动
}
function computeMergePps(totalDuration) {
  const w = mergeTrackWidth();
  if (!w || !totalDuration) return MERGE_MIN_PPS;
  return Math.max(w / totalDuration, MERGE_MIN_PPS);
}
function mergeBoundaries() {
  const bs = [0];
  let acc = 0;
  for (const c of mergeClips) { acc += c.duration || 0; bs.push(Math.round(acc * 1000) / 1000); }
  return bs;
}
function mergeSnap(t) {
  const bs = mergeBoundaries();
  let best = bs[0];
  let bestDiff = Infinity;
  for (const b of bs) { const d = Math.abs(b - t); if (d < bestDiff) { bestDiff = d; best = b; } }
  return best;
}

function renderMergeRuler(pps, d) {
  els.mergeRuler.innerHTML = '';
  const frag = document.createDocumentFragment();
  const step = niceStep(80 / pps);
  for (let t = 0; t <= d + step; t += step) {
    const tick = document.createElement('div');
    tick.className = 'r-tick';
    tick.style.left = (t * pps) + 'px';
    frag.appendChild(tick);
    const label = document.createElement('div');
    label.className = 'r-label';
    label.style.left = (t * pps) + 'px';
    label.textContent = fmtTime(t).replace(/\.\d{3}$/, '').replace(/^0+(\d):/, '$1:');
    frag.appendChild(label);
  }
  els.mergeRuler.appendChild(frag);
}

function updateMergeRegion() {
  const r = els.mergeRegion;
  if (!r) return;
  const d = mergeDuration();
  if (!d || end - start <= 0) { r.style.display = 'none'; return; }
  r.style.display = 'block';
  r.style.left = (start * mergePps()) + 'px';
  r.style.width = ((end - start) * mergePps()) + 'px';
}

function updateMergePlayhead() {
  const p = els.mergePlayhead;
  if (!p) return;
  if (!mergeMode || !mergeDuration()) { p.style.display = 'none'; return; }
  p.style.display = 'block';
  p.style.left = (currentTime * mergePps()) + 'px';
  els.playTime.textContent = fmtTime(currentTime);
}

function renderMergeBody(pps) {
  els.mergeBody.innerHTML = '';
  mergeClips.forEach((c, i) => {
    const w = Math.max(16, (c.duration || 0) * pps);
    const el = document.createElement('div');
    el.className = 'm-clip';
    el.dataset.id = c.id;
    el.style.width = w + 'px';
    el.title = `${c.name} · ${fmtTime(c.duration)} · ${c.width}×${c.height}${c.videoCodec ? ' · ' + c.videoCodec : ''}`;

    const idx = document.createElement('span');
    idx.className = 'm-clip-index';
    idx.textContent = String(i + 1);

    const thumb = document.createElement('div');
    thumb.className = 'm-clip-thumb';
    if (c.filmUrl) {
      const img = document.createElement('img');
      img.src = c.filmUrl;
      img.draggable = false;
      img.style.width = (c.filmW || 0) + 'px'; // 胶片条自然宽度，超出部分由容器裁剪
      img.style.height = '100%';
      thumb.appendChild(img);
    }

    const name = document.createElement('div');
    name.className = 'm-clip-name';
    name.textContent = c.name;

    const meta = document.createElement('div');
    meta.className = 'm-clip-meta';
    meta.textContent = fmtTime(c.duration);

    el.appendChild(idx);
    el.appendChild(thumb);
    el.appendChild(name);
    el.appendChild(meta);
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      showMergeClipMenu(ev.clientX, ev.clientY, c.id);
    });
    els.mergeBody.appendChild(el);
  });
}

function updateMergeView() {
  const d = mergeDuration();
  els.mergeTitle.textContent = `合并轨道：${mergeClips.length} 个片段 · 总时长 ${fmtTime(d)}`;
  const pps = mergePps();
  els.mergeTrack.style.width = (d * pps) + 'px';
  renderMergeRuler(pps, d);
  renderMergeBody(pps);
  updateMergeRegion();
  updateMergePlayhead();

  const uniform = mergeClips.length > 1 && mergeClips.every((c) =>
    c.videoCodec === mergeClips[0].videoCodec &&
    c.width === mergeClips[0].width &&
    c.height === mergeClips[0].height &&
    Math.abs((c.fps || 0) - (mergeClips[0].fps || 0)) < 0.02 &&
    c.hasAudio === mergeClips[0].hasAudio &&
    c.audioCodec === mergeClips[0].audioCodec
  );
  els.vInfo.innerHTML =
    `<div><span class="k">片段数</span>${mergeClips.length}</div>` +
    `<div><span class="k">总时长</span>${fmtTime(d)}</div>` +
    `<div><span class="k">分辨率</span>${mergeClips[0] ? mergeClips[0].width + '×' + mergeClips[0].height : '—'}</div>` +
    `<div><span class="k">视频编码</span>${mergeClips[0] ? (mergeClips[0].videoCodec || '—') : '—'}</div>` +
    `<div><span class="k">合并方式</span>${mergeClips.length > 1 ? (uniform ? '无损流复制' : '统一重编码') : '—'}</div>`;
}

function enterMergeMode() {
  mergeMode = true;
  pause();
  els.filmstripArea.style.display = 'none'; // 合并模式下隐藏胶片条，用合并轨道作为时间轴
  els.mergeArea.hidden = false;
  els.vBtnExport.textContent = '导出（合并 + 剪切）';
  updateMergeView();
  loadMergePreview(); // 生成合并预览并加载到播放器（异步）
}

// 把当前片段顺序合并成临时预览，并加载到播放器（合并轨道本身作为时间轴）。
async function loadMergePreview() {
  if (!mergeClips.length) return;
  const mySeq = mergeSeq;
  setStatus('正在生成合并预览…');
  try {
    const previewPath = await api.mergePreview({ inputs: mergeClips.map((c) => c.path) });
    if (mySeq !== mergeSeq || !mergeMode) return; // 期间已清空 / 退出合并
    mergePreviewPath = previewPath;
    // 保留当前选区 / 播放线 / 增益 / 缩放，重载预览后不变
    pendingRestore = { start, end, currentTime, gainDb: parseFloat(els.vGainInput.value) || 0, spt: requestSpt, fit: isFit };
    await loadFile(previewPath, { keepMerge: true });
    if (mySeq === mergeSeq && mergeMode) {
      els.vBtnExport.textContent = '导出（合并 + 剪切）';
      els.vFname.textContent = `合并预览（${mergeClips.length} 个片段）`;
      updateMergeView(); // 恢复合并信息卡与轨道
      setStatus(`合并模式：${mergeClips.length} 个片段，左右拖动片段调整顺序；设置入/出点后导出（合并 + 剪切）。`);
    }
  } catch (e) {
    if (mySeq === mergeSeq) setStatus('合并预览失败：' + (e && e.message ? e.message : e), true);
  }
}

function exitMergeMode() {
  mergeMode = false;
  els.mergeArea.hidden = true;
  els.filmstripArea.style.display = '';
  els.mergePlayhead.style.display = 'none';
  hideMergeClipMenu();
  els.vBtnExport.textContent = '导出（无损剪切）';
}

function removeMergeClip(id) {
  const c = mergeClips.find((x) => x.id === id);
  if (c && c.filmUrl) URL.revokeObjectURL(c.filmUrl);
  mergeClips = mergeClips.filter((x) => x.id !== id);
  if (!mergeClips.length) {
    mergeSeq++;
    mergeMode = false;
    filePath = null; meta = null; duration = 0; keyframes = [];
    mergePreviewPath = null;
    clearVideoView();
    return;
  }
  loadMergePreview();
  refreshMergeFilms(mergeSeq); // 片段减少后密度可能变化，刷新胶片条
}

// 添加一批视频片段（用于合并）。入口：文件 → 添加视频（合并）。
async function addMergePaths(paths) {
  const mySeq = ++mergeSeq;
  const seen = new Set(mergeClips.map((c) => c.path));
  const fresh = [];
  for (const p of paths) {
    if (!seen.has(p)) { seen.add(p); fresh.push(p); }
  }
  if (!fresh.length) { enterMergeMode(); return; }

  setStatus(`正在添加 ${fresh.length} 个视频片段…`);
  // 先探测时长/信息
  const probed = await Promise.all(fresh.map(async (p) => {
    try { return { path: p, info: await api.probeVideo(p) }; }
    catch (e) { setStatus('读取失败：' + p, true); return null; }
  }));
  if (mySeq !== mergeSeq) return;

  let added = 0;
  for (const x of probed) {
    if (!x) continue;
    const info = x.info;
    mergeClips.push({
      id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      path: x.path,
      name: x.path.split(/[\\/]/).pop(),
      duration: info.duration || 0,
      width: info.width, height: info.height, fps: info.fps,
      videoCodec: info.videoCodec, audioCodec: info.audioCodec, hasAudio: info.hasAudio,
      filmUrl: '', filmW: 0,
    });
    added++;
  }
  if (!mergeClips.length) return;

  enterMergeMode();           // 显示合并轨道（获得正确宽度），开始生成合并预览
  refreshMergeFilms(mySeq);   // 统一生成 / 刷新所有片段的胶片条缩略图
  setStatus(`已添加 ${added} 个片段；左右拖动片段调整顺序。`);
}

// 生成 / 刷新合并片段胶片条。新增片段总是生成；密度变化时旧片段也重新生成。
async function refreshMergeFilms(seq) {
  const pps = computeMergePps(mergeDuration());
  const spt = MERGE_TW / pps;
  const changed = mergeSpt > 0 && Math.abs(spt - mergeSpt) > 1e-6;
  mergeSpt = spt;
  const targets = mergeClips.filter((c) => changed || !c.filmUrl);
  if (!targets.length) { updateMergeView(); return; }

  await Promise.all(targets.map(async (c) => {
    try {
      const fs = await api.filmstrip(c.path, { spt, thumbWidth: MERGE_TW, thumbHeight: MERGE_TH });
      if (seq !== mergeSeq) return;
      if (c.filmUrl) URL.revokeObjectURL(c.filmUrl);
      c.filmUrl = URL.createObjectURL(new Blob([fs.png], { type: 'image/png' }));
      c.filmW = fs.count * fs.thumbWidth;
    } catch (e) { /* 保留无缩略图状态 */ }
  }));
  if (seq === mergeSeq) updateMergeView();
}

// 合并轨道右键菜单（删除片段）
let mergeMenuEl = null;
function hideMergeClipMenu() {
  if (mergeMenuEl) { mergeMenuEl.remove(); mergeMenuEl = null; }
  document.removeEventListener('pointerdown', onDocHideMergeMenu);
}
function onDocHideMergeMenu(ev) {
  if (mergeMenuEl && !mergeMenuEl.contains(ev.target)) hideMergeClipMenu();
}
function showMergeClipMenu(x, y, clipId) {
  hideMergeClipMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  const del = document.createElement('button');
  del.className = 'ctx-item danger';
  del.textContent = '删除片段';
  del.onclick = () => { hideMergeClipMenu(); removeMergeClip(clipId); };
  menu.appendChild(del);
  document.body.appendChild(menu);
  mergeMenuEl = menu;
  document.addEventListener('pointerdown', onDocHideMergeMenu);
}

// 合并轨道指针：拖动片段排序 / 点击空白定位播放线。
function mergeOnPointerDown(e) {
  if (!mergeMode) return;
  if (e.button !== 0) return; // 仅左键；右键由 contextmenu 处理
  const clip = e.target.closest ? e.target.closest('.m-clip') : null;
  if (!clip) {
    // 点击空白处定位播放线（同时驱动视频）
    const rect = els.mergeBody.getBoundingClientRect();
    seekTo(clampT((e.clientX - rect.left) / mergePps()));
    return;
  }
  mergeDrag = { id: clip.dataset.id, startX: e.clientX, startY: e.clientY, moved: false, wasReorder: false };
  e.preventDefault();
}
function mergeOnPointerMove(e) {
  if (!mergeDrag) return;
  const dx = e.clientX - mergeDrag.startX;
  const dy = e.clientY - mergeDrag.startY;
  if (!mergeDrag.moved) {
    if (Math.hypot(dx, dy) < 6) return;
    mergeDrag.moved = true;
    mergeDrag.wasReorder = true;
  }
  e.preventDefault();
  const el = els.mergeBody.querySelector(`.m-clip[data-id="${mergeDrag.id}"]`);
  if (!el) return;
  el.classList.add('dragging');
  let inserted = false;
  for (const other of els.mergeBody.querySelectorAll('.m-clip')) {
    if (other === el) continue;
    const r = other.getBoundingClientRect();
    if (e.clientX < r.left + r.width / 2) {
      els.mergeBody.insertBefore(el, other);
      inserted = true;
      break;
    }
  }
  if (!inserted) els.mergeBody.appendChild(el);
}
function mergeOnPointerUp() {
  if (!mergeDrag) return;
  if (mergeDrag.wasReorder) {
    const order = [...els.mergeBody.querySelectorAll('.m-clip')].map((el) => el.dataset.id);
    const before = mergeClips.map((c) => c.id).join(',');
    mergeClips.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const after = mergeClips.map((c) => c.id).join(',');
    if (before !== after) loadMergePreview(); // 顺序变化后重新生成预览
  }
  mergeDrag = null;
  updateMergeView();
}

// 视频信息卡（关键帧数后台加载期间显示「读取中…」）
function renderInfo() {
  const kfText = keyframes.length ? String(keyframes.length) : '读取中…';
  els.vInfo.innerHTML =
    `<div><span class="k">时长</span>${fmtTime(duration)}</div>` +
    `<div><span class="k">分辨率</span>${meta.width}×${meta.height}</div>` +
    `<div><span class="k">帧率</span>${(meta.fps || 0).toFixed(3)} fps</div>` +
    `<div><span class="k">视频编码</span>${meta.videoCodec || '—'}</div>` +
    `<div><span class="k">音频编码</span>${meta.audioCodec || '—'}</div>` +
    `<div><span class="k">容器</span>${meta.format || '—'}</div>` +
    `<div><span class="k">关键帧数</span>${kfText}</div>`;
}

// 等视频元数据就绪（可 seek / 可播放），不依赖缩略图。
function videoMetaReady() {
  return new Promise((resolve) => {
    const el = els.videoEl;
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
    const timer = setTimeout(finish, 10000);
    if (el.readyState >= 1) { finish(); return; }
    el.addEventListener('loadedmetadata', finish, { once: true });
    el.addEventListener('error', finish, { once: true });
  });
}

// 后台加载关键帧并生成缩略图（不阻塞播放）。
async function loadKeyframesAndFilmstrip(p) {
  try {
    const kf = await api.getKeyframes(p);
    if (filePath !== p) return; // 已切换文件
    keyframes = kf;
    renderInfo(); // 更新「关键帧数」
    await regenFilmstrip();
    if (filePath === p && isFit) fitZoom();
  } catch (e) {
    if (filePath === p) setStatus('缩略图生成失败：' + (e && e.message ? e.message : e), true);
  }
}

async function loadFile(p, opts = {}) {
  if (!opts.keepMerge) exitMergeMode(); // 普通加载退出合并轨道；合并预览加载则保留
  filePath = p;
  ready = false;
  if (regenTimer) { clearTimeout(regenTimer); regenTimer = null; }
  els.btnPlay.disabled = true;
  els.vFname.textContent = p.split(/[\\/]/).pop();
  els.vFmeta.textContent = '读取中…';
  els.videoHint.style.display = 'flex';
  els.videoHint.textContent = '正在加载视频…';
  els.vBtnExport.disabled = true;
  try {
    meta = await api.probeVideo(p);
    duration = meta.duration || 0;
    if (!duration) throw new Error('无法读取视频时长');
    currentTime = 0;
    start = 0;
    end = duration;
    keyframes = []; // 关键帧稍后后台加载，先清空避免残留

    clearFilm();

    els.videoEl.src = mediaUrl(p);
    els.videoEl.load();

    els.vFmeta.textContent = `${meta.width}×${meta.height} · ${(meta.fps || 0).toFixed(2)}fps · ${meta.videoCodec.toUpperCase()}${meta.hasAudio ? ' + ' + meta.audioCodec.toUpperCase() : '（无音轨）'} · ${fmtTime(duration)} · ${(meta.size / 1024 / 1024).toFixed(1)}MB`;
    renderInfo();
    els.vBtnExport.disabled = false;

    // 恢复标签页保存的选区 / 播放线 / 缩放 / 增益
    if (pendingRestore) {
      const r = pendingRestore;
      pendingRestore = null;
      start = Math.max(0, Math.min(r.start || 0, duration));
      end = (r.end > 0 && r.end <= duration) ? r.end : duration;
      if (end <= start) { start = 0; end = duration; }
      currentTime = Math.min(r.currentTime || 0, duration);
      requestSpt = r.spt || requestSpt;
      isFit = Boolean(r.fit);
      if (r.gainDb) {
        els.vGainSlider.value = r.gainDb;
        els.vGainInput.value = r.gainDb;
        updateGainUI();
      }
    }

    updateTimes();
    // 视频可播放即可交互，不再等待关键帧/缩略图（它们后台异步生成）
    await videoMetaReady();
    seekTo(currentTime);
    ready = true;
    els.btnPlay.disabled = false;
    els.videoHint.style.display = 'none';
    setStatus('已加载：' + p);

    if (!opts.keepMerge) loadKeyframesAndFilmstrip(p); // 合并模式用合并轨道做时间轴，无需胶片条
  } catch (e) {
    els.videoHint.style.display = 'flex';
    els.videoHint.textContent = '加载失败';
    setStatus('加载失败：' + (e && e.message ? e.message : e), true);
  }
}

// ---------------- 导出（流复制） ----------------
function isFull() {
  return start <= 0.001 && end >= duration - 0.001;
}

async function doExport() {
  const db = parseFloat(els.vGainInput.value) || 0;

  if (mergeMode) {
    if (!mergeClips.length || !duration) return;
    if (end - start <= 0) { setStatus('选区为空', true); return; }
    els.vBtnExport.disabled = true;
    setStatus('正在合并并剪切…');
    setProgress(0);
    try {
      const res = await api.mergeCut({
        inputs: mergeClips.map((c) => c.path),
        start,
        end,
        outDir: settings.outDir,
        customDir: settings.customDir,
        db,
      });
      setProgress(1);
      setStatus('已保存：' + res.output + '　｜　' + res.note);
      if (window.confirm('合并剪切完成！\n\n' + res.output + '\n\n是否在文件夹中显示该文件？')) {
        api.reveal(res.output);
      }
    } catch (e) {
      setStatus('合并剪切失败：' + (e && e.message ? e.message : e), true);
    } finally {
      els.vBtnExport.disabled = false;
    }
    return;
  }

  if (!filePath || !duration) return;
  if (isFull()) {
    setStatus('未选择剪切范围：请先设置入点/出点', true);
    return;
  }
  if (end - start <= 0) { setStatus('选区为空', true); return; }
  els.vBtnExport.disabled = true;
  setStatus(db !== 0 ? '正在无损剪切并应用音量增益…' : '正在无损剪切（流复制）…');
  setProgress(0);
  try {
    const res = await api.cutVideo({
      input: filePath,
      start,
      end,
      outDir: settings.outDir,
      customDir: settings.customDir,
      db,
    });
    setProgress(1);
    setStatus('已保存：' + res.output + '　｜　' + res.note);
    if (window.confirm('剪切完成！\n\n' + res.output + '\n\n是否在文件夹中显示该文件？')) {
      api.reveal(res.output);
    }
  } catch (e) {
    setStatus('剪切失败：' + (e && e.message ? e.message : e), true);
  } finally {
    els.vBtnExport.disabled = false;
  }
}

// ---------------- 初始化 ----------------
export const VideoTool = {
  init(deps) {
    api = deps.api;
    fmtTime = deps.fmtTime;
    setStatus = deps.setStatus;
    setProgress = deps.setProgress;
    setIcon = deps.setIcon;
    ICONS = deps.ICONS;

    els = {
      btnOpen: $('v-btn-open'), vFname: $('v-fname'), vFmeta: $('v-fmeta'),
      btnPlay: $('v-btn-play'), btnStop: $('v-btn-stop'), playTime: $('v-play-time'),
      btnZoomOut: $('v-btn-zoom-out'), btnZoomIn: $('v-btn-zoom-in'), btnZoomFit: $('v-btn-zoom-fit'), vZoomLabel: $('v-zoom-label'),
      videoArea: $('video-area'), videoHint: $('video-hint'), videoEl: $('video-el'), videoPreview: $('video-preview'),
      filmstripArea: $('filmstrip-area'), filmstripScroll: $('filmstrip-scroll'), filmstripTrack: $('filmstrip-track'),
      filmstripBody: $('filmstrip-body'), filmstripImg: $('filmstrip-img'),
      vRuler: $('v-ruler'), vKeys: $('v-keys'), vRegion: $('v-region'),
      vPlayhead: $('v-playhead'), vPlayheadGrab: $('v-playhead-grab'),
      mergeArea: $('v-merge-area'), mergeTitle: $('v-merge-title'),
      mergeScroll: $('v-merge-scroll'), mergeTrack: $('v-merge-track'),
      mergeRuler: $('v-merge-ruler'), mergeBody: $('v-merge-body'),
      mergeRegion: $('v-merge-region'), mergePlayhead: $('v-merge-playhead'),
      vStepSelect: $('v-step-select'),
      vInTime: $('v-in-time'), vOutTime: $('v-out-time'), vSelDur: $('v-sel-dur'),
      vBtnExport: $('v-btn-export'),
      vNudgePrev: $('v-nudge-prev'), vNudgeNext: $('v-nudge-next'),
      vBtnSetIn: $('v-btn-set-in'), vBtnSetOut: $('v-btn-set-out'),
      vTbSetIn: $('v-tb-set-in'), vTbSetOut: $('v-tb-set-out'),
      vInfo: $('v-info'),
      vGainSlider: $('v-gain-slider'), vGainInput: $('v-gain-input'), vGainHint: $('v-gain-hint'), vBadge: $('v-badge'),
      vBtnBrowse: $('v-btn-browse'), vCustomDirRow: $('v-custom-dir-row'), vCustomDirLabel: $('v-custom-dir-label'),
    };

    els.btnOpen.onclick = openFileDialog;
    els.btnPlay.onclick = () => { if (!ready) return; if (els.videoEl.paused) els.videoEl.play(); else els.videoEl.pause(); };
    els.btnStop.onclick = () => { if (!ready) return; els.videoEl.pause(); els.videoEl.currentTime = 0; };

    els.btnZoomIn.onclick = () => zoomBy(0.7);
    els.btnZoomOut.onclick = () => zoomBy(1.4);
    els.btnZoomFit.onclick = () => fitZoom();

    els.filmstripScroll.addEventListener('wheel', (e) => {
      if (!film || !duration) return;
      e.preventDefault();
      if (e.altKey) {
        // Alt+滚轮：左右平移时间轴
        const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        els.filmstripScroll.scrollLeft += delta;
        updatePlayhead();
      } else {
        // Ctrl+滚轮（或普通滚轮，与音频一致）：缩放时间轴（节流，避免连续滚动刷爆 ffmpeg）
        const now = Date.now();
        if (now - lastWheelZoomAt < 150) return;
        lastWheelZoomAt = now;
        zoomBy(e.deltaY < 0 ? 0.8 : 1.25);
      }
    }, { passive: false });

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);

    els.vNudgePrev.onclick = () => nudge(-1);
    els.vNudgeNext.onclick = () => nudge(1);
    els.vBtnSetIn.onclick = setIn;
    els.vBtnSetOut.onclick = setOut;
    els.vTbSetIn.onclick = setIn;
    els.vTbSetOut.onclick = setOut;
    els.vBtnExport.onclick = doExport;
    els.mergeBody.addEventListener('pointerdown', mergeOnPointerDown);
    document.addEventListener('pointermove', mergeOnPointerMove);
    document.addEventListener('pointerup', mergeOnPointerUp);
    document.addEventListener('pointercancel', mergeOnPointerUp);

    els.videoEl.addEventListener('timeupdate', () => {
      // 仅在播放时用视频时间驱动播放线；暂停时（拖拽/微调）以我们的精确时间为准。
      if (els.videoEl.paused) return;
      currentTime = els.videoEl.currentTime || 0;
      if (mergeMode) updateMergePlayhead();
      else updatePlayhead();
    });
    els.videoEl.addEventListener('play', () => {
      if (!ready) { els.videoEl.pause(); return; } // 尚未就绪（胶片条生成中）不允许播放，避免音画不同步
      setIcon(els.btnPlay, 'pause'); setupLiveGain(); resumeGain();
    });
    els.videoEl.addEventListener('pause', () => setIcon(els.btnPlay, 'play'));
    els.videoEl.addEventListener('ended', () => setIcon(els.btnPlay, 'play'));

    els.vGainSlider.oninput = () => { els.vGainInput.value = els.vGainSlider.value; updateGainUI(); };
    els.vGainInput.oninput = () => { els.vGainSlider.value = els.vGainInput.value; updateGainUI(); };

    document.querySelectorAll('input[name="v-outdir"]').forEach((r) => {
      r.onchange = () => { settings.outDir = r.value; els.vCustomDirRow.hidden = settings.outDir !== 'custom'; saveSettings(); };
    });
    els.vBtnBrowse.onclick = async () => {
      const dir = await api.chooseFolder();
      if (dir) { settings.customDir = dir; els.vCustomDirLabel.textContent = dir; saveSettings(); }
    };
    els.vCustomDirLabel.textContent = settings.customDir || '（未选择）';

    // 恢复设置
    api.getSettings().then((s) => {
      if (s && s.video) Object.assign(settings, s.video);
      const rd = document.querySelector(`input[name="v-outdir"][value="${settings.outDir}"]`);
      if (rd) rd.checked = true;
      els.vCustomDirRow.hidden = settings.outDir !== 'custom';
      els.vCustomDirLabel.textContent = settings.customDir || '（未选择）';
    }).catch(() => {});

    updateGainUI();

    window.addEventListener('resize', () => { if (mergeMode) updateMergeView(); else if (isFit && duration) fitZoom(); });
  },

  openFileDialog,
  openInTab,
  loadFile,
  zoomBy,
  fitZoom,
  selectAll,
  nudge,
  setIn,
  setOut,
  addMergePaths,
  async openMergeDialog() {
    // 若当前有已加载的单文件（且尚未进入合并），把它作为合并的第一段，再叠加本次选择的文件。
    const base = (!mergeMode && filePath) ? [filePath] : [];
    const paths = await api.openVideos();
    if (!paths || !paths.length) {
      // 用户取消选择：仅当已有可合并的已加载单文件时才进入合并（否则保持现状）
      if (base.length) addMergePaths(base);
      return;
    }
    addMergePaths(base.concat(paths));
  },
  togglePlay() { if (ready && els.videoEl && duration) { if (els.videoEl.paused) els.videoEl.play(); else els.videoEl.pause(); } },
  pause,
  onShown() { if (mergeMode) updateMergeView(); else if (isFit && duration) fitZoom(); },
  onProgress(value) {
    const total = end - start;
    const pct = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
    setProgress(pct);
    setStatus(`正在剪切… ${Math.round(pct * 100)}%`);
  },
  hasFile() { return mergeMode ? mergeClips.length > 0 : Boolean(filePath); },
};

function saveSettings() {
  api.setSettings({ video: settings }).catch(() => {});
}
