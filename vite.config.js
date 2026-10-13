import { defineConfig } from 'vite';

// Renderer 源码在 src/，打包产物输出到 dist/（Electron 主进程加载 dist/index.html）。
export default defineConfig({
  root: 'src',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020'
  }
});
