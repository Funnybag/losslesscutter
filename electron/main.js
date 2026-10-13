'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const audio = require('./audio');
const video = require('./video');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#12151c',
    title: 'LosslessCutter',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false, // 允许 <video> 直接播放 file:// 本地视频（本地文件编辑器场景）
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // 去掉原生菜单，改用页面内的暗色菜单栏

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- 设置持久化 ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveSettings(s) {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
  } catch (e) {
    console.error('save settings failed', e);
  }
}

// ---------- IPC ----------
ipcMain.handle('open-file', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择音频文件',
    properties: ['openFile'],
    filters: [
      { name: '音频文件', extensions: ['mp3', 'flac', 'wav', 'aiff', 'aif', 'm4a', 'alac', 'ogg', 'opus', 'aac', 'wma', 'ape', 'wv', 'caf'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('choose-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择输出文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('probe', async (_e, filePath) => audio.probe(filePath));
ipcMain.handle('decode-preview', async (_e, filePath) => audio.decodePreview(filePath));

ipcMain.handle('export', async (e, payload) => {
  return audio.exportAudio(payload, (p) => e.sender.send('progress', { type: 'export', value: p }));
});

// ---------- 视频（无损剪切） ----------
ipcMain.handle('open-video', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频文件',
    properties: ['openFile'],
    filters: [
      { name: '视频文件', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'ts', 'mts', 'm2ts', 'flv', 'wmv', 'mpg', 'mpeg', '3gp', 'ogv'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('open-videos', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择一个或多个视频（用于合并）',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '视频文件', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'ts', 'mts', 'm2ts', 'flv', 'wmv', 'mpg', 'mpeg', '3gp', 'ogv'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('video-thumb', async (_e, filePath, opts) => video.thumbnail(filePath, opts));

ipcMain.handle('probe-video', async (_e, filePath) => video.probe(filePath));
ipcMain.handle('get-keyframes', async (_e, filePath) => video.getKeyframes(filePath));
ipcMain.handle('filmstrip', async (_e, filePath, opts) => video.filmstrip(filePath, opts));

ipcMain.handle('cut-video', async (e, payload) => {
  return video.cut(payload, (p) => e.sender.send('progress', { type: 'vcut', value: p }));
});

ipcMain.handle('merge-videos', async (e, payload) => {
  return video.mergeVideos(payload, (p) => e.sender.send('progress', { type: 'vmerge', value: p }));
});

ipcMain.handle('merge-cut', async (e, payload) => {
  return video.mergeAndCut(payload, (p) => e.sender.send('progress', { type: 'vcut', value: p }));
});

ipcMain.handle('merge-preview', async (_e, payload) => {
  return video.mergePreview(payload);
});

ipcMain.handle('quit', () => { app.quit(); });

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('set-settings', (_e, s) => saveSettings(s));
ipcMain.handle('reveal', (_e, p) => {
  if (p && fs.existsSync(p)) shell.showItemInFolder(p);
});
ipcMain.handle('get-bins', () => ({
  ffmpeg: audio.FFMPEG(),
  ffprobe: audio.FFPROBE(),
  mp3gain: audio.MP3GAIN(),
}));
