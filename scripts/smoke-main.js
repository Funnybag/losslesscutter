'use strict';
// 无头冒烟测试：加载 dist/index.html，检查渲染进程是否报错、DOM 是否渲染，并截图。
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const errors = [];

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1360, height: 860, show: false,
    backgroundColor: '#12151c',
    webPreferences: {
      preload: path.join(root, 'electron', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) { console.log('[console-lvl' + level + ']', message); errors.push(message); }
  });
  win.webContents.on('preload-error', (_e, p, error) => { console.log('[preload-error]', p, error); errors.push(String(error)); });
  win.webContents.on('render-process-gone', (_e, d) => { console.log('[render-gone]', JSON.stringify(d)); errors.push('render-gone'); });

  try {
    await win.loadFile(path.join(root, 'dist', 'index.html'));
  } catch (e) {
    console.log('[load-error]', e); errors.push(String(e));
  }

  await new Promise((r) => setTimeout(r, 3500));

  let domInfo = {};
  try {
    domInfo = await win.webContents.executeJavaScript(`(() => {
      const q = (s) => !!document.querySelector(s);
      return {
        btnOpen: q('#btn-open'), btnCut: q('#btn-cut'), btnGain: q('#btn-gain'),
        waveform: q('#waveform'), scrollbar: q('#scrollbar'), timeline: q('#waveform .wavesurfer-timeline'),
        waveChildren: document.querySelector('#waveform') ? document.querySelector('#waveform').children.length : -1,
        waveHtml: document.querySelector('#waveform') ? document.querySelector('#waveform').innerHTML.slice(0, 200) : '',
        status: document.querySelector('#status-text') ? document.querySelector('#status-text').textContent : '',
      };
    })()`);
  } catch (e) { errors.push('executeJavaScript: ' + e.message); }

  let shot = false;
  try {
    const img = await win.capturePage();
    fs.writeFileSync('/tmp/smoke.png', img.toPNG());
    shot = true;
  } catch (e) { errors.push('capturePage: ' + e.message); }

  console.log('SMOKE_DOM:', JSON.stringify(domInfo));
  console.log('SMOKE_SCREENSHOT:', shot);
  console.log('SMOKE_ERRORS:', errors.length ? JSON.stringify(errors) : 'none');
  console.log('SMOKE_DONE');
  app.quit();
});
