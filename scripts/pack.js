'use strict';
// 用 electron-packager 程序化 API 交叉打包 Windows x64，输出到 release/（与 vite 的 dist/ 分离）。
const packager = require('@electron/packager');
const path = require('path');

const root = path.join(__dirname, '..');
const platform = process.argv[2] || 'win32';
const arch = process.argv[3] || 'x64';
const binDir = platform === 'win32' ? 'win32' : 'linux';
const otherBin = platform === 'win32' ? 'linux' : 'win32';

packager({
  dir: root,
  name: 'LosslessCutter',
  appVersion: '1.0.0',
  platform,
  arch,
  out: path.join(root, 'release'),
  overwrite: true,
  asar: true,
  prune: true,
  extraResource: [path.join(root, 'resources', 'bin', binDir)],
  ignore: (p) => {
    const rel = String(p).replace(/\\/g, '/').replace(/^\//, '');
    return ['src', 'scripts', `resources/bin/${otherBin}`, 'release', '.git', 'node_modules']
      .some((seg) => rel === seg || rel.startsWith(seg + '/'));
  },
})
  .then((paths) => { console.log('PACK_OK:', JSON.stringify(paths)); })
  .catch((e) => { console.error('PACK_ERR:', e && e.stack ? e.stack : e); process.exit(1); });
