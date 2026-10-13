'use strict';
// 端到端测试：生成测试音频 -> probe -> 无损剪切 -> 无损增益，验证正确性。
const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const audio = require('../electron/audio');

const FFMPEG = audio.FFMPEG();
const dir = path.join(__dirname, '..', '.test-output');
fs.mkdirSync(dir, { recursive: true });

function run(bin, args) {
  return cp.execFileSync(bin, args, { encoding: 'utf8' });
}

function vol(f) {
  const r = cp.spawnSync(FFMPEG, ['-i', f, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  return (r.stderr || '').split('\n').filter((l) => l.includes('mean_volume') || l.includes('max_volume')).join(' | ');
}

async function main() {
  console.log('FFMPEG exists:', fs.existsSync(FFMPEG), FFMPEG);
  console.log('MP3GAIN exists:', fs.existsSync(audio.MP3GAIN()), audio.MP3GAIN());

  const wav = path.join(dir, 'test.wav');
  const flac = path.join(dir, 'test.flac');
  const mp3 = path.join(dir, 'test.mp3');

  console.log('\n[1] generating test files (10s sine 440Hz, stereo, 44.1kHz)...');
  run(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-ac', '2', '-ar', '44100', wav]);
  run(FFMPEG, ['-y', '-i', wav, '-c:a', 'flac', flac]);
  run(FFMPEG, ['-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '192k', mp3]);

  console.log('\n[2] probe:');
  for (const f of [wav, flac, mp3]) {
    const m = await audio.probe(f);
    console.log(' ', path.basename(f), '=>', JSON.stringify(m));
  }

  console.log('\n[3] cut FLAC [2.000, 5.000] (lossless sample-accurate):');
  const flacCut = await audio.cut({ input: flac, start: 2.0, end: 5.0, format: 'same', outDir: 'custom', customDir: dir });
  const fcDur = (await audio.probe(flacCut.output)).duration;
  console.log('   output:', flacCut.output);
  console.log('   note:', flacCut.note);
  console.log('   duration =', fcDur.toFixed(6), 's  (期望 3.000000)');

  console.log('\n[4] cut MP3 [2.000, 5.000] (lossless frame-aligned):');
  const mp3Cut = await audio.cut({ input: mp3, start: 2.0, end: 5.0, format: 'same', outDir: 'custom', customDir: dir });
  const mcDur = (await audio.probe(mp3Cut.output)).duration;
  console.log('   output:', mp3Cut.output);
  console.log('   note:', mp3Cut.note);
  console.log('   duration =', mcDur.toFixed(6), 's  (期望约 3.0，误差 < 26ms)');

  console.log('\n[5] gain FLAC +6dB (lossless re-encode):');
  const flacGain = await audio.applyGain({ input: flac, db: 6, outDir: 'custom', customDir: dir });
  console.log('   output:', flacGain.output);
  console.log('   note:', flacGain.note);
  console.log('   duration =', (await audio.probe(flacGain.output)).duration.toFixed(6), 's');
  console.log('   orig vol:', vol(flac));
  console.log('   +6dB vol:', vol(flacGain.output));

  console.log('\n[6] gain MP3 +6dB (mp3rgain lossless):');
  const mp3Gain = await audio.applyGain({ input: mp3, db: 6, outDir: 'custom', customDir: dir });
  console.log('   output:', mp3Gain.output);
  console.log('   note:', mp3Gain.note);
  console.log('   probe:', JSON.stringify(await audio.probe(mp3Gain.output)));

  console.log('\n[7] export FLAC: 剪切 [2,5] + 增益 +6dB 合并一次导出:');
  const flacBoth = await audio.exportAudio({ input: flac, start: 2.0, end: 5.0, db: 6, format: 'same', outDir: 'custom', customDir: dir, isFull: false });
  console.log('   output:', flacBoth.output);
  console.log('   note:', flacBoth.note);
  console.log('   duration =', (await audio.probe(flacBoth.output)).duration.toFixed(6), 's  (期望 3.000000)');
  console.log('   原 vol:', vol(flac));
  console.log('   合并 vol:', vol(flacBoth.output));

  console.log('\n[8] export MP3: 剪切 [2,5] + 增益 +6dB 合并一次导出:');
  const mp3Both = await audio.exportAudio({ input: mp3, start: 2.0, end: 5.0, db: 6, format: 'same', outDir: 'custom', customDir: dir, isFull: false });
  console.log('   output:', mp3Both.output);
  console.log('   note:', mp3Both.note);
  console.log('   duration =', (await audio.probe(mp3Both.output)).duration.toFixed(6), 's  (期望约 3.0，误差 < 26ms)');

  console.log('\n[9] export MP3: 整段 + 增益 +6dB（不剪切）:');
  const mp3FullGain = await audio.exportAudio({ input: mp3, start: 0, end: 10, db: 6, format: 'same', outDir: 'custom', customDir: dir, isFull: true });
  console.log('   output:', mp3FullGain.output);
  console.log('   note:', mp3FullGain.note);
  console.log('   duration =', (await audio.probe(mp3FullGain.output)).duration.toFixed(6), 's  (期望 10.0)');

  console.log('\n[10] export WAV -> MP3（格式转换，有损）:');
  const wav2mp3 = await audio.exportAudio({ input: wav, start: 0, end: 10, db: 0, format: 'mp3', outDir: 'custom', customDir: dir, isFull: true });
  console.log('   output:', wav2mp3.output);
  console.log('   note:', wav2mp3.note);
  console.log('   probe:', JSON.stringify(await audio.probe(wav2mp3.output)));

  console.log('\nALL TESTS DONE ✔');
}

main().catch((e) => { console.error('TEST FAILED:', e); process.exit(1); });
