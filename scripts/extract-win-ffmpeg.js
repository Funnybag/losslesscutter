'use strict';
// 从 BtbN 的 Windows zip 中提取 ffmpeg.exe / ffprobe.exe 到 resources/bin/win32
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

const zipPath = path.join(__dirname, '..', 'resources', 'tmp', 'ffmpeg-win.zip');
const outDir = path.join(__dirname, '..', 'resources', 'bin', 'win32');
fs.mkdirSync(outDir, { recursive: true });

console.log('reading zip (loading into memory, please wait)...');
const zip = new AdmZip(zipPath);
const entries = zip.getEntries();

let done = 0;
for (const entry of entries) {
  const m = entry.entryName.match(/(?:^|\/)(ffmpeg|ffprobe)\.exe$/);
  if (m && !entry.isDirectory) {
    const name = m[1] + '.exe';
    const dest = path.join(outDir, name);
    const data = entry.getData();
    fs.writeFileSync(dest, data);
    console.log('extracted', name, data.length, 'bytes ->', dest);
    done++;
  }
}
console.log('total extracted:', done);
