'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('open-file'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  probe: (p) => ipcRenderer.invoke('probe', p),
  decodePreview: (p) => ipcRenderer.invoke('decode-preview', p),
  exportAudio: (payload) => ipcRenderer.invoke('export', payload),
  openVideo: () => ipcRenderer.invoke('open-video'),
  openVideos: () => ipcRenderer.invoke('open-videos'),
  probeVideo: (p) => ipcRenderer.invoke('probe-video', p),
  getKeyframes: (p) => ipcRenderer.invoke('get-keyframes', p),
  filmstrip: (p, opts) => ipcRenderer.invoke('filmstrip', p, opts),
  videoThumb: (p, opts) => ipcRenderer.invoke('video-thumb', p, opts),
  cutVideo: (payload) => ipcRenderer.invoke('cut-video', payload),
  mergeVideos: (payload) => ipcRenderer.invoke('merge-videos', payload),
  mergeCut: (payload) => ipcRenderer.invoke('merge-cut', payload),
  mergePreview: (payload) => ipcRenderer.invoke('merge-preview', payload),
  fileUrl: (p) => pathToFileURL(p).toString(),
  quit: () => ipcRenderer.invoke('quit'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (s) => ipcRenderer.invoke('set-settings', s),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  getBins: () => ipcRenderer.invoke('get-bins'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p) => cb(p)),
});
