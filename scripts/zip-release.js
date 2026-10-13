'use strict';
// 将 release 目录打包为单个 zip（流式，低内存）。
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const root = path.join(__dirname, '..');
const platform = process.argv[2] || 'win32';
const arch = process.argv[3] || 'x64';
const name = `LosslessCutter-${platform}-${arch}`;
const srcDir = path.join(root, 'release', name);
const outZip = path.join(root, 'release', `${name}.zip`);

if (!fs.existsSync(srcDir)) { console.error('not found:', srcDir); process.exit(1); }

const output = fs.createWriteStream(outZip);
const archive = archiver('zip', { zlib: { level: 6 } });

output.on('close', () => {
  console.log('ZIP_DONE:', outZip, '=>', (archive.pointer() / 1024 / 1024).toFixed(1), 'MB');
});
archive.on('warning', (e) => { if (e.code !== 'ENOENT') console.warn('ZIP_WARN', e.message); });
archive.on('error', (e) => { console.error('ZIP_ERR', e); process.exit(1); });

archive.pipe(output);
archive.directory(srcDir, name);
archive.finalize();
