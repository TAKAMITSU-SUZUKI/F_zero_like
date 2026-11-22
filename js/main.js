// @ts-check
// 起動処理とメインループ（最後に読み込む）
// ※ ファイルは index.html に書いた順に読み込まれ、変数や関数はファイル間で共有される
buildMinimap();
updateSetupUI();
document.getElementById('bgmToggle').addEventListener('click', () => toggleAudio('bgm'));
document.getElementById('seToggle').addEventListener('click', () => toggleAudio('se'));
applyAudioSettings();
applyOptions();
onlineCheckInvite();

let lastFrameAt = performance.now();
function loop(now) {
  const dt = Math.min(2, Math.max(0, (now - lastFrameAt) / 16.6667));
  lastFrameAt = now;
  updateTilt();
  watchViewportSize();
  // ゴール直後はスローモーション。一時停止中はゲームを進めない
  const slowMotion = car.status === 'finished' && finishAt !== null && now - finishAt < 2600 ? 0.3 : 1;
  if (paused) syncMusic(now);
  else update(dt * slowMotion, now);
  onlineTick(now);
  if (window.render3D) window.render3D(now);
  else draw();
  // 数フレーム描いて画面が落ち着いてから起動画面を消す
  if (splashFrames < 4 && ++splashFrames === 4) document.getElementById('splash').classList.add('hide');
  requestAnimationFrame(loop);
}
let splashFrames = 0;
requestAnimationFrame(loop);
