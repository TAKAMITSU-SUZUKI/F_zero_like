// @ts-check
// サウンド（Web Audioで合成した効果音・エンジン音・BGM）
// ※ ファイルは index.html に書いた順に読み込まれ、変数や関数はファイル間で共有される
// ===== サウンド（Web Audioで合成。音声ファイル不要） =====
// 構成: 効果音バス / BGMバス（上モノはキックに合わせて沈ませる）+ 共通リバーブ + BGM用ステレオディレイ
// 曲はすべてオリジナル（高速ロック／フュージョン調のレースゲーム風）
const audioSettings = { bgm: true, se: true };
try {
  Object.assign(audioSettings, JSON.parse(localStorage.getItem('fzx-audio') || '{}'));
} catch (error) {
  // 設定を読めない環境では既定値（両方ON）
}
const A = audioState;   // 短縮名
const MUSIC_LEVEL = 0.5;

function makeDriveCurve(amount) {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

// ドラム音はJSで波形を計算してバッファ化（ロックキット風）
function buildDrumSamples(context) {
  const sr = context.sampleRate;
  const make = (seconds, fill) => {
    const length = Math.floor(sr * seconds);
    const buffer = context.createBuffer(1, length, sr);
    const data = buffer.getChannelData(0);
    fill(data, sr);
    let peak = 0;
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0) for (let i = 0; i < length; i++) data[i] *= 0.9 / peak;
    return buffer;
  };
  const highpass = (data, a) => {
    let prevX = 0, prevY = 0;
    for (let i = 0; i < data.length; i++) {
      const y = a * (prevY + data[i] - prevX);
      prevX = data[i];
      prevY = y;
      data[i] = y;
    }
  };
  const metallic = t => [205.3, 304.4, 369.6, 522.7, 540, 800]
    .reduce((sum, f) => sum + (Math.sin(2 * Math.PI * f * 1.9 * t) > 0 ? 1 : -1), 0) / 6;
  const tom = base => make(0.5, (d, sr2) => {
    let phase = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr2;
      phase += 2 * Math.PI * (base + base * 0.6 * Math.exp(-t * 18)) / sr2;
      d[i] = Math.tanh((Math.sin(phase) * Math.exp(-t * 7) + (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.25) * 1.5);
    }
  });
  return {
    kick: make(0.45, (d, sr2) => {
      let phase = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr2;
        phase += 2 * Math.PI * (52 + 140 * Math.exp(-t * 34)) / sr2;
        const body = Math.sin(phase) * Math.exp(-t * 9);
        const click = (Math.random() * 2 - 1) * Math.exp(-t * 600) * 0.6;
        d[i] = Math.tanh((body + click) * 2.4);
      }
    }),
    snare: make(0.32, (d, sr2) => {
      const noise = new Float32Array(d.length);
      for (let i = 0; i < d.length; i++) noise[i] = Math.random() * 2 - 1;
      highpass(noise, 0.7);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr2;
        const tone = (Math.sin(2 * Math.PI * 200 * t) + 0.6 * Math.sin(2 * Math.PI * 340 * t)) * Math.exp(-t * 26);
        d[i] = Math.tanh((tone * 0.7 + noise[i] * Math.exp(-t * 16)) * 1.6);
      }
    }),
    hat: make(0.08, (d, sr2) => {
      for (let i = 0; i < d.length; i++) d[i] = metallic(i / sr2) * 0.7 + (Math.random() * 2 - 1) * 0.3;
      highpass(d, 0.32);
      highpass(d, 0.32);
      for (let i = 0; i < d.length; i++) d[i] *= Math.exp(-(i / sr2) * 70);
    }),
    open: make(0.45, (d, sr2) => {
      for (let i = 0; i < d.length; i++) d[i] = metallic(i / sr2) * 0.7 + (Math.random() * 2 - 1) * 0.3;
      highpass(d, 0.32);
      highpass(d, 0.32);
      for (let i = 0; i < d.length; i++) d[i] *= Math.exp(-(i / sr2) * 8);
    }),
    crash: make(2.4, (d, sr2) => {
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.8 + metallic(i / sr2 * 1.3) * 0.3;
      highpass(d, 0.45);
      highpass(d, 0.45);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr2;
        d[i] *= Math.exp(-t * 2) * (1 - Math.exp(-t * 300));
      }
    }),
    tomHigh: tom(190),
    tomMid: tom(140),
    tomLow: tom(100)
  };
}

function buildImpulse(context, seconds, decay) {
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      smooth = smooth * 0.55 + (Math.random() * 2 - 1) * 0.45;
      data[i] = smooth * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function startAudio() {
  if (A.failed) return;
  if (!A.context) {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return;
    try {
      const context = new AudioContextConstructor();
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 10;
      compressor.ratio.value = 3.5;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.2;
      compressor.connect(context.destination);
      const master = context.createGain();
      master.gain.value = 0.62;
      master.connect(compressor);

      const sfxBus = context.createGain();
      const musicBus = context.createGain();
      sfxBus.connect(master);
      musicBus.connect(master);
      const musicDuck = context.createGain();
      musicDuck.connect(musicBus);

      const impulse = buildImpulse(context, 2.2, 3);
      const makeReverb = bus => {
        const convolver = context.createConvolver();
        convolver.buffer = impulse;
        const input = context.createGain();
        const tone = context.createBiquadFilter();
        tone.type = 'highpass';
        tone.frequency.value = 220;
        input.connect(tone);
        tone.connect(convolver);
        convolver.connect(bus);
        return input;
      };
      const musicReverb = makeReverb(musicBus);
      const sfxReverb = makeReverb(sfxBus);

      const delayIn = context.createGain();
      const delayL = context.createDelay(1.5);
      const delayR = context.createDelay(1.5);
      const feedback = context.createGain();
      const delayTone = context.createBiquadFilter();
      delayTone.type = 'lowpass';
      delayTone.frequency.value = 3200;
      feedback.gain.value = 0.32;
      delayIn.connect(delayL);
      delayL.connect(delayR);
      delayR.connect(delayTone);
      delayTone.connect(feedback);
      feedback.connect(delayL);
      // StereoPanner がない古いブラウザでは GainNode で代用するため any 扱い
      /** @type {any} */
      const panL = context.createStereoPanner ? context.createStereoPanner() : context.createGain();
      /** @type {any} */
      const panR = context.createStereoPanner ? context.createStereoPanner() : context.createGain();
      if (panL.pan) { panL.pan.value = -0.6; panR.pan.value = 0.6; }
      const delayOut = context.createGain();
      delayOut.gain.value = 0.45;
      delayL.connect(panL);
      delayR.connect(panR);
      panL.connect(delayOut);
      panR.connect(delayOut);
      delayOut.connect(musicBus);

      const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

      Object.assign(A, {
        context, master, sfxBus, musicBus, musicDuck, musicReverb, sfxReverb, delayIn, delayL, delayR,
        noiseBuffer, drums: buildDrumSamples(context),
        driveSoft: makeDriveCurve(2.2), driveHard: makeDriveCurve(7)
      });
      buildEngine(context);
      applyAudioSettings();
      setInterval(musicSchedulerTick, 25);
    } catch (error) {
      A.failed = true;
      console.warn('Web Audio could not be initialized.', error);
      return;
    }
  }
  unlockMobileAudio();
  if (A.context.state !== 'running') {
    A.context.resume().catch(error => {
      console.warn('Web Audio could not be resumed.', error);
    });
  }
}
// スマホで音が出ない対策
//  ・iPhone はマナー（消音）スイッチがONだとWeb Audioが無音になる → 「再生」用の音声として扱わせる
//  ・ブラウザは「指を離した」「タップした」操作の中でしか音を出し始められない → その瞬間に無音を1回鳴らして解錠する
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let silentAudioEl = null;
function unlockMobileAudio() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch (error) {
    // 対応していないブラウザでは何もしない
  }
  if (!silentAudioEl) {
    silentAudioEl = document.createElement('audio');
    silentAudioEl.src = SILENT_WAV;
    silentAudioEl.loop = true;
    silentAudioEl.setAttribute('playsinline', '');
    silentAudioEl.setAttribute('x-webkit-airplay', 'deny');
  }
  if (silentAudioEl.paused) {
    const played = silentAudioEl.play();
    if (played && played.catch) played.catch(() => {});
  }
  if (A.context && !A.unlocked) {
    const source = A.context.createBufferSource();
    source.buffer = A.context.createBuffer(1, 1, 22050);
    source.connect(A.context.destination);
    source.start(0);
    A.unlocked = A.context.state === 'running';
  }
}
['pointerdown', 'touchend', 'click', 'keydown'].forEach(type => addEventListener(type, startAudio, { capture: true, passive: true }));
// ゲームを閉じた・別のアプリに切り替えたら音を完全に止め、戻ってきたら再開する
function stopAllAudio() {
  if (silentAudioEl) silentAudioEl.pause();
  if (A.context && A.context.state === 'running') A.context.suspend().catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopAllAudio();
  else if (A.context && A.context.state !== 'running') startAudio();
});
addEventListener('pagehide', stopAllAudio);
addEventListener('blur', () => { if (document.hidden) stopAllAudio(); });
// 閉じたページが「戻る」などで保存状態から復元されたときは、古い画面を出さずに読み込み直す
addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});

// レースマシンらしいエンジン音:
//  ・高く唸る「ヴィーン」: 矩形波＋5度上ののこぎり波をバンドパスで絞り、細かいビブラート
//  ・低い唸り: 1/4の高さののこぎり波
//  ・ガードビームに擦った時の電気的な「ビリビリ」、風切り、ドリフト音
//  ・すれ違うライバルのエンジン（ドップラー効果で「ヒューン」）
function buildEngine(context) {
  const makeOsc = (type, freq) => {
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.start();
    return osc;
  };
  const voiceFilter = context.createBiquadFilter();
  voiceFilter.type = 'bandpass';
  voiceFilter.frequency.value = 900;
  voiceFilter.Q.value = 1.4;
  const whineGain = context.createGain();
  whineGain.gain.value = 0.0001;
  const main = makeOsc('square', 120);
  const fifth = makeOsc('sawtooth', 180);
  const fifthGain = context.createGain();
  fifthGain.gain.value = 0.5;
  main.connect(voiceFilter);
  fifth.connect(fifthGain);
  fifthGain.connect(voiceFilter);
  voiceFilter.connect(whineGain);
  whineGain.connect(A.sfxBus);
  const vibrato = makeOsc('sine', 9);
  const vibratoDepth = context.createGain();
  vibratoDepth.gain.value = 3;
  vibrato.connect(vibratoDepth);
  vibratoDepth.connect(main.frequency);
  vibratoDepth.connect(fifth.frequency);

  const rumble = makeOsc('sawtooth', 40);
  const rumbleFilter = context.createBiquadFilter();
  rumbleFilter.type = 'lowpass';
  rumbleFilter.frequency.value = 220;
  const rumbleGain = context.createGain();
  rumbleGain.gain.value = 0.0001;
  rumble.connect(rumbleFilter);
  rumbleFilter.connect(rumbleGain);
  rumbleGain.connect(A.sfxBus);

  // ガードビームの電気音
  const buzz = makeOsc('sawtooth', 110);
  const buzz2 = makeOsc('square', 113);
  const buzzFilter = context.createBiquadFilter();
  buzzFilter.type = 'bandpass';
  buzzFilter.frequency.value = 1800;
  buzzFilter.Q.value = 2;
  const buzzGain = context.createGain();
  buzzGain.gain.value = 0.0001;
  buzz.connect(buzzFilter);
  buzz2.connect(buzzFilter);
  buzzFilter.connect(buzzGain);
  buzzGain.connect(A.sfxBus);

  // すれ違うライバル
  const rival = makeOsc('square', 200);
  const rivalFilter = context.createBiquadFilter();
  rivalFilter.type = 'bandpass';
  rivalFilter.frequency.value = 1100;
  rivalFilter.Q.value = 1.2;
  const rivalGain = context.createGain();
  rivalGain.gain.value = 0.0001;
  const rivalPan = context.createStereoPanner ? context.createStereoPanner() : context.createGain();
  rival.connect(rivalFilter);
  rivalFilter.connect(rivalGain);
  rivalGain.connect(rivalPan);
  rivalPan.connect(A.sfxBus);

  const makeLoop = (type, frequency, q) => {
    const source = context.createBufferSource();
    source.buffer = A.noiseBuffer;
    source.loop = true;
    const loopFilter = context.createBiquadFilter();
    loopFilter.type = type;
    loopFilter.frequency.value = frequency;
    loopFilter.Q.value = q;
    const loopGain = context.createGain();
    loopGain.gain.value = 0.0001;
    source.connect(loopFilter);
    loopFilter.connect(loopGain);
    loopGain.connect(A.sfxBus);
    source.start();
    return { filter: loopFilter, gain: loopGain };
  };
  A.engine = { main, fifth, voiceFilter, whineGain, rumble, rumbleGain, buzzGain, buzzFilter, rival, rivalGain, rivalPan, rivalFilter };
  A.wind = makeLoop('bandpass', 600, 0.6);
  A.grind = makeLoop('bandpass', 2600, 3);
  A.driftHiss = makeLoop('highpass', 4200, 0.9);
}

function applyAudioSettings() {
  if (A.context) {
    const now = A.context.currentTime;
    A.sfxBus.gain.setTargetAtTime(audioSettings.se && !paused ? 1 : 0, now, 0.05);
    A.musicBus.gain.setTargetAtTime(audioSettings.bgm ? MUSIC_LEVEL : 0, now, 0.05);
  }
  const bgmButton = document.getElementById('bgmToggle');
  const seButton = document.getElementById('seToggle');
  if (bgmButton) bgmButton.textContent = `♪ BGM: ${audioSettings.bgm ? 'ON' : 'OFF'}`;
  if (seButton) seButton.textContent = `🔊 SE: ${audioSettings.se ? 'ON' : 'OFF'}`;
  try {
    localStorage.setItem('fzx-audio', JSON.stringify(audioSettings));
  } catch (error) {
    // 保存できなくても再生には影響しない
  }
}
function toggleAudio(kind) {
  startAudio();
  audioSettings[kind] = !audioSettings[kind];
  applyAudioSettings();
}

// ---- 音を鳴らす部品 ----
function routeSound(node, o) {
  const context = A.context;
  let out = node;
  if (o.pan && context.createStereoPanner) {
    const panner = context.createStereoPanner();
    panner.pan.value = clamp(o.pan, -1, 1);
    node.connect(panner);
    out = panner;
  }
  const music = o.bus === 'music' || o.bus === 'duck';
  out.connect(o.bus === 'duck' ? A.musicDuck : (music ? A.musicBus : A.sfxBus));
  if (o.reverb) {
    const send = context.createGain();
    send.gain.value = o.reverb;
    out.connect(send);
    send.connect(music ? A.musicReverb : A.sfxReverb);
  }
  if (o.echo && music) {
    const send = context.createGain();
    send.gain.value = o.echo;
    out.connect(send);
    send.connect(A.delayIn);
  }
}
// 1音（エンベロープ・フィルター・歪み・ビブラート付き）
function voice(o) {
  const context = A.context;
  const t = o.at !== undefined ? o.at : context.currentTime + (o.wait || 0);
  const dur = o.dur;
  const attack = o.attack !== undefined ? o.attack : 0.005;
  const release = o.release !== undefined ? o.release : 0.08;
  const osc = context.createOscillator();
  osc.type = o.type || 'sawtooth';
  osc.frequency.setValueAtTime(o.freqFrom || o.freq, t);
  if (o.freqFrom) osc.frequency.exponentialRampToValueAtTime(o.freq, t + 0.04);   // しゃくり上げ（ギター風）
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t + (o.glide || dur));
  if (o.detune) osc.detune.value = o.detune;
  let head = osc;
  if (o.drive) {
    const shaper = context.createWaveShaper();
    shaper.curve = o.drive > 3 ? A.driveHard : A.driveSoft;
    head.connect(shaper);
    head = shaper;
  }
  if (o.cutoff) {
    const filter = context.createBiquadFilter();
    filter.type = o.filterType || 'lowpass';
    filter.Q.value = o.q || 0.8;
    filter.frequency.setValueAtTime(o.cutoff, t);
    if (o.cutoffPeak) {
      filter.frequency.exponentialRampToValueAtTime(o.cutoffPeak, t + 0.03);
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.cutoffEnd || o.cutoff), t + 0.03 + (o.filterTime || dur));
    } else if (o.cutoffEnd) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.cutoffEnd), t + (o.filterTime || dur));
    }
    head.connect(filter);
    head = filter;
  }
  const env = context.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(o.vol, t + attack);
  if (o.decay) env.gain.setTargetAtTime(o.vol * (o.sustain !== undefined ? o.sustain : 0.6), t + attack, o.decay / 3);
  env.gain.setTargetAtTime(0.0001, t + dur, release / 4);
  head.connect(env);
  routeSound(env, o);
  if (o.vibrato) {
    const lfo = context.createOscillator();
    const depth = context.createGain();
    lfo.frequency.value = 6;
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(o.vibrato, t + 0.22);
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + release + 0.1);
  }
  osc.start(t);
  osc.stop(t + dur + release + 0.1);
  osc.onended = () => osc.disconnect();
}
function supersaw(o) {
  const spread = o.spread || 14;
  [-spread, -spread / 2, 0, spread / 2, spread].forEach((d, i) => voice({
    ...o, type: 'sawtooth', detune: d + (o.detune || 0), vol: o.vol / 2.4, pan: (o.pan || 0) + (i - 2) * 0.18
  }));
}
function noiseBurst(o) {
  const context = A.context;
  const t = o.at !== undefined ? o.at : context.currentTime + (o.wait || 0);
  const source = context.createBufferSource();
  source.buffer = A.noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = o.filter || 'lowpass';
  filter.Q.value = o.q || 0.8;
  filter.frequency.setValueAtTime(o.f0, t);
  if (o.f1) filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1), t + (o.sweep || o.dur));
  let head = filter;
  source.connect(filter);
  if (o.drive) {
    const shaper = context.createWaveShaper();
    shaper.curve = A.driveHard;
    filter.connect(shaper);
    head = shaper;
  }
  const env = context.createGain();
  const attack = o.attack || 0.004;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(o.vol, t + attack);
  env.gain.setTargetAtTime(0.0001, t + attack, (o.dur - attack) / 4);
  head.connect(env);
  routeSound(env, o);
  source.start(t, Math.random() * 1.2);
  source.stop(t + o.dur + 0.1);
  source.onended = () => source.disconnect();
}
function drumHit(name, at, vol, o = {}) {
  const context = A.context;
  const source = context.createBufferSource();
  source.buffer = A.drums[name];
  const gain = context.createGain();
  gain.gain.value = vol;
  source.connect(gain);
  routeSound(gain, { bus: o.bus || 'music', pan: o.pan, reverb: o.reverb });
  source.start(at);
  source.onended = () => source.disconnect();
}
function clang(at, vol, base) {
  [1, 2.32, 3.41, 4.63, 6.1].forEach((ratio, i) => voice({
    type: 'sine', freq: base * ratio, at, dur: 0.05, vol: vol / (i + 1.4), attack: 0.002,
    release: 0.35 - i * 0.05, reverb: 0.25, pan: (i % 2 ? 0.2 : -0.2)
  }));
}
// 電気がはじけるような音（接触・ガードビーム）
function zap(at, vol, from, to, dur) {
  voice({ type: 'square', freq: from, freqEnd: to, at, dur, vol, cutoff: 5000, release: 0.03 });
  voice({ type: 'sawtooth', freq: from * 1.5, freqEnd: to * 1.5, at, dur, vol: vol * 0.5, cutoff: 6000, release: 0.03, pan: 0.3 });
}
const midiToFreq = note => 440 * Math.pow(2, (note - 69) / 12);

// ---- 効果音 ----
function playCue(name) {
  if (!A.context) return;
  const now = A.context.currentTime;
  switch (name) {
    case 'ui':
      voice({ type: 'square', freq: 1568, dur: 0.03, vol: 0.06, cutoff: 5000, release: 0.04 });
      break;
    case 'ok':
      voice({ type: 'square', freq: 1047, dur: 0.06, vol: 0.07, cutoff: 5000 });
      voice({ type: 'square', freq: 1568, wait: 0.07, dur: 0.14, vol: 0.07, cutoff: 5000, release: 0.2, reverb: 0.2 });
      break;
    case 'boost':
      // シュゴォッ: 吸気の風切り＋点火の低音＋上昇するジェット音
      noiseBurst({ dur: 1.0, vol: 0.38, filter: 'bandpass', f0: 250, f1: 4200, sweep: 0.35, q: 1.6, reverb: 0.2 });
      voice({ type: 'sine', freq: 110, freqEnd: 38, dur: 0.3, vol: 0.55, release: 0.1, drive: 2 });
      supersaw({ freq: 140, freqEnd: 560, glide: 0.3, dur: 0.45, vol: 0.16, cutoff: 900, cutoffEnd: 5000, filterTime: 0.3, release: 0.3, drive: 2 });
      break;
    case 'dash':
      noiseBurst({ dur: 0.8, vol: 0.32, filter: 'bandpass', f0: 600, f1: 7000, sweep: 0.4, q: 2.2, reverb: 0.25 });
      [0, 0.06, 0.12].forEach((wait, i) => voice({
        type: 'square', freq: 660 * Math.pow(1.5, i), wait, dur: 0.06, vol: 0.06, cutoff: 6000, release: 0.1
      }));
      break;
    case 'charge':
      // ピット回復中の「チュイーン」（エネルギー量で音が上がる）
      voice({ type: 'triangle', freq: 300 + car.energy * 9, freqEnd: 360 + car.energy * 10, dur: 0.1, vol: 0.06, release: 0.08 });
      break;
    case 'contact':
      // バチィン: 金属音＋電気スパーク＋低い衝撃
      clang(now, 0.3, 480 + Math.random() * 160);
      zap(now, 0.09, 2400, 180, 0.16);
      noiseBurst({ dur: 0.28, vol: 0.5, filter: 'bandpass', f0: 2200, f1: 500, q: 1.3, drive: 1 });
      voice({ type: 'sine', freq: 140, freqEnd: 45, dur: 0.2, vol: 0.55, release: 0.1, drive: 2 });
      break;
    case 'explode':
    case 'mine':
      noiseBurst({ dur: 1.6, vol: 0.75, filter: 'lowpass', f0: 5500, f1: 70, sweep: 1.4, drive: 1, reverb: 0.5 });
      voice({ type: 'sine', freq: 100, freqEnd: 26, dur: 0.9, vol: 0.75, release: 0.3, drive: 3 });
      for (let i = 0; i < 12; i++) {
        noiseBurst({ wait: 0.04 + Math.random() * 0.8, dur: 0.04, vol: 0.2, filter: 'bandpass', f0: 2500 + Math.random() * 3000, q: 3, pan: Math.random() * 1.6 - 0.8 });
      }
      if (name === 'mine') zap(now, 0.08, 3000, 400, 0.12);
      break;
    case 'ko':
      voice({ type: 'square', freq: 784, dur: 0.08, vol: 0.08, cutoff: 5000 });
      voice({ type: 'square', freq: 1175, wait: 0.09, dur: 0.2, vol: 0.08, cutoff: 5000, release: 0.2, reverb: 0.2 });
      break;
    case 'retire':
      [392, 370, 349, 330].forEach((freq, i) => voice({
        type: 'square', freq, wait: i * 0.22, dur: 0.2, vol: 0.07, cutoff: 2500, release: 0.2, vibrato: i === 3 ? 8 : 0
      }));
      break;
    case 'alarm':
      // エネルギー低下の警告音「ピピッ」
      voice({ type: 'square', freq: 1760, dur: 0.06, vol: 0.09, cutoff: 6000 });
      voice({ type: 'square', freq: 1760, wait: 0.1, dur: 0.06, vol: 0.09, cutoff: 6000 });
      break;
    case 'damage':
      zap(now, 0.06, 1800, 300, 0.1);
      break;
    case 'fall':
      voice({ type: 'square', freq: 1400, freqEnd: 120, glide: 1.2, dur: 1.2, vol: 0.07, cutoff: 3000, release: 0.2 });
      noiseBurst({ dur: 1.4, vol: 0.3, filter: 'bandpass', f0: 2500, f1: 250, q: 1.5, reverb: 0.3 });
      break;
    case 'respawn':
      [0, 0.06, 0.12, 0.18].forEach((wait, i) => voice({
        type: 'square', freq: 523 * Math.pow(1.26, i), wait, dur: 0.05, vol: 0.06, cutoff: 5000, release: 0.15, reverb: 0.3
      }));
      noiseBurst({ dur: 0.7, vol: 0.12, filter: 'highpass', f0: 3000, f1: 9000, reverb: 0.4 });
      break;
    case 'drift':
      voice({ type: 'square', freq: 1400 + Math.min(car.driftCombo, 10) * 70, dur: 0.02, vol: 0.05, cutoff: 6000, release: 0.05 });
      break;
    case 'jump':
      noiseBurst({ dur: 0.8, vol: 0.28, filter: 'bandpass', f0: 400, f1: 3500, sweep: 0.5, q: 1.4, reverb: 0.3 });
      voice({ type: 'square', freq: 330, freqEnd: 990, glide: 0.35, dur: 0.35, vol: 0.06, cutoff: 4000, release: 0.2 });
      break;
    case 'land':
      voice({ type: 'sine', freq: 130, freqEnd: 38, dur: 0.25, vol: 0.65, release: 0.1, drive: 3 });
      noiseBurst({ dur: 0.35, vol: 0.4, filter: 'lowpass', f0: 2500, f1: 200 });
      zap(now, 0.05, 1500, 200, 0.1);
      break;
    case 'lap':
      voice({ type: 'square', freq: 1319, dur: 0.08, vol: 0.07, cutoff: 6000 });
      voice({ type: 'square', freq: 1760, wait: 0.1, dur: 0.25, vol: 0.07, cutoff: 6000, release: 0.2, reverb: 0.25 });
      break;
    case 'count':
      // スタートシグナルの「ピッ」
      voice({ type: 'square', freq: 880, dur: 0.16, vol: 0.12, cutoff: 6000, release: 0.05, reverb: 0.2 });
      break;
    case 'go':
      voice({ type: 'square', freq: 1760, dur: 0.7, vol: 0.12, cutoff: 7000, release: 0.1, reverb: 0.25 });
      drumHit('crash', now, 0.35, { bus: 'sfx', reverb: 0.3 });
      break;
    case 'final':
      [0, 0.12, 0.24].forEach((wait, i) => voice({
        type: 'square', freq: 1047 * Math.pow(1.335, i), wait, dur: i === 2 ? 0.5 : 0.1, vol: 0.08, cutoff: 6000, release: 0.2, reverb: 0.25
      }));
      break;
    case 'finish': {
      // 勝利ファンファーレ（ブラスのスタブ＋タム＋クラッシュ）
      /** @type {Array<[number, number[]]>} */
      const hits = [[0, [72, 76, 79]], [0.18, [72, 76, 79]], [0.36, [74, 77, 81]], [0.72, [76, 79, 84]]];
      hits.forEach(([wait, chord], i) => chord.forEach(note => supersaw({
        freq: midiToFreq(note), wait, dur: i === 3 ? 1.3 : 0.12, vol: 0.12,
        cutoff: 900, cutoffPeak: 5500, cutoffEnd: 2200, filterTime: 0.25, release: 0.4, reverb: 0.35, vibrato: i === 3 ? 5 : 0
      })));
      [0, 0.18, 0.36].forEach(wait => drumHit('tomMid', now + wait, 0.6, { bus: 'sfx' }));
      drumHit('kick', now + 0.72, 0.8, { bus: 'sfx' });
      drumHit('crash', now + 0.72, 0.45, { bus: 'sfx', reverb: 0.4 });
      break;
    }
    case 'record':
      [0, 0.08, 0.16, 0.24].forEach((wait, i) => voice({
        type: 'square', freq: 1047 * Math.pow(1.26, i), wait, dur: 0.07, vol: 0.06, cutoff: 6000, release: 0.2, reverb: 0.3
      }));
      break;
    case 'pit':
      voice({ type: 'triangle', freq: 880, freqEnd: 1320, dur: 0.18, vol: 0.07, release: 0.15, reverb: 0.25 });
      break;
    case 'comboTier':
      // ドリドリ5コンボごと: 上昇するきらめき＋短い噴射音
      [0, 0.05, 0.1, 0.15].forEach((wait, i) => voice({
        type: 'square', freq: 1319 * Math.pow(1.19, i), wait, dur: 0.05, vol: 0.06, cutoff: 7000, release: 0.12, reverb: 0.25
      }));
      noiseBurst({ dur: 0.4, vol: 0.2, filter: 'bandpass', f0: 800, f1: 6000, sweep: 0.25, q: 1.8 });
      break;
    case 'break':
      voice({ type: 'sawtooth', freq: 660, freqEnd: 110, glide: 0.35, dur: 0.35, vol: 0.07, cutoff: 2200, release: 0.1, drive: 2 });
      break;
    case 'attack':
      // 体当たり: 重い衝撃＋大きな金属音＋電撃
      voice({ type: 'sine', freq: 120, freqEnd: 35, dur: 0.3, vol: 0.8, release: 0.12, drive: 3 });
      clang(now, 0.4, 360 + Math.random() * 120);
      zap(now, 0.12, 3200, 150, 0.22);
      noiseBurst({ dur: 0.35, vol: 0.55, filter: 'lowpass', f0: 4000, f1: 300, drive: 1 });
      break;
    case 'deny':
      voice({ type: 'square', freq: 196, dur: 0.12, vol: 0.06, cutoff: 1500 });
      voice({ type: 'square', freq: 147, wait: 0.13, dur: 0.16, vol: 0.06, cutoff: 1500 });
      break;
    case 'upgrade':
      // 強化: 上昇アルペジオ＋ブラスの和音
      [0, 0.07, 0.14, 0.21, 0.28].forEach((wait, i) => voice({
        type: 'square', freq: midiToFreq(72 + [0, 4, 7, 12, 16][i]), wait, dur: 0.06, vol: 0.06, cutoff: 6000, release: 0.15, reverb: 0.3
      }));
      [76, 79, 84].forEach(note => supersaw({
        freq: midiToFreq(note), wait: 0.36, dur: 0.45, vol: 0.09, cutoff: 900, cutoffPeak: 5000, cutoffEnd: 2000,
        filterTime: 0.2, release: 0.35, reverb: 0.35
      }));
      noiseBurst({ wait: 0.36, dur: 0.6, vol: 0.12, filter: 'highpass', f0: 4000, f1: 9000, reverb: 0.4 });
      break;
    case 'points':
      // ポイント獲得: コインのような連続音
      for (let i = 0; i < 6; i++) {
        voice({ type: 'square', freq: 1976, wait: i * 0.09, dur: 0.03, vol: 0.05, cutoff: 7000, release: 0.05 });
        voice({ type: 'square', freq: 2637, wait: i * 0.09 + 0.035, dur: 0.05, vol: 0.05, cutoff: 7000, release: 0.1, reverb: 0.2 });
      }
      break;
    default: break;
  }
}

// 毎フレーム: エンジン・ガードビーム・風切り・ドリフト・すれ違うライバル
function updateEngineAudio(canBoost) {
  if (!A.context || !A.engine) return;
  const now = A.context.currentTime;
  const e = A.engine;
  const active = car.status === 'racing' && !selectingMachine && !(car.fallTimer > 0);
  const speedRatio = Math.min(1.2, car.speed / 24);
  const pitch = 95 + speedRatio * 330 + (canBoost ? 90 : 0) + (car.air ? 60 : 0);
  e.main.frequency.setTargetAtTime(pitch, now, 0.08);
  e.fifth.frequency.setTargetAtTime(pitch * 1.5, now, 0.08);
  e.voiceFilter.frequency.setTargetAtTime(500 + speedRatio * 1800 + (canBoost ? 800 : 0), now, 0.1);
  e.whineGain.gain.setTargetAtTime(active ? 0.025 + speedRatio * 0.05 : 0.0001, now, 0.1);
  e.rumble.frequency.setTargetAtTime(pitch / 4, now, 0.1);
  e.rumbleGain.gain.setTargetAtTime(active ? 0.06 + speedRatio * 0.05 : 0.0001, now, 0.1);
  A.wind.gain.gain.setTargetAtTime(active ? 0.0001 + speedRatio * speedRatio * 0.12 + (canBoost ? 0.06 : 0) : 0.0001, now, 0.15);
  A.wind.filter.frequency.setTargetAtTime(400 + speedRatio * 1800 + (canBoost ? 900 : 0), now, 0.15);
  const beam = active && car.scraping;
  e.buzzGain.gain.setTargetAtTime(beam ? 0.11 : 0.0001, now, 0.02);
  e.buzzFilter.frequency.setTargetAtTime(1400 + Math.random() * 1200, now, 0.02);
  A.grind.gain.gain.setTargetAtTime(active && (car.scraping || car.onRough) ? 0.12 : 0.0001, now, 0.03);
  A.grind.filter.frequency.setTargetAtTime(car.onRough ? 700 : 3200, now, 0.05);
  A.driftHiss.gain.gain.setTargetAtTime(active && car.drifting ? 0.05 + Math.min(car.driftCombo, 8) * 0.006 : 0.0001, now, 0.05);

  // 一番近いライバルのエンジン音（近づくと高く、追い越すと低くなる）
  /** @type {{ racer: any, gap: number } | null} */
  let nearest = null;
  if (active) {
    racers.forEach(racer => {
      if (racer.status !== 'racing') return;
      const gap = racer.dist - car.dist;
      if (Math.abs(gap) < 240 && (!nearest || Math.abs(gap) < Math.abs(nearest.gap))) nearest = { racer, gap };
    });
  }
  if (nearest) {
    const closeness = 1 - Math.abs(nearest.gap) / 240;
    const doppler = nearest.gap > 0 === (car.speed > nearest.racer.speed) ? 1.1 : 0.88;
    e.rival.frequency.setTargetAtTime((110 + nearest.racer.speed * 16) * doppler, now, 0.12);
    e.rivalGain.gain.setTargetAtTime(closeness * closeness * 0.07, now, 0.08);
    if (e.rivalPan.pan) {
      e.rivalPan.pan.setTargetAtTime(clamp((nearest.racer.lane * RIVAL_LANE_SCALE - car.x * PLAYER_LANE_SCALE) * 2.5, -1, 1), now, 0.08);
    }
  } else {
    e.rivalGain.gain.setTargetAtTime(0.0001, now, 0.1);
  }
}

// ===== BGM（ステップシーケンサー。すべてオリジナル曲） =====
// 90年代のレースゲーム風アレンジ:
//  ・裏拍に食い込むブラスのキメ ・オクターブで跳ねるスラップベース ・歪みギター/シンセブラスのリード
//  ・イントロ → A（Aメロ）→ B（サビ）の構成。2周目は全音上に転調して盛り上げる
// 書式:
//  chords: 1小節ごとのコード（root=ベース音, notes=構成音。MIDIノート番号）
//  lead: 小節ごとのメロディ [開始ステップ, MIDIノート, 長さ(ステップ)]
//  kick/snare/hat/bass/stab/chug: 16ステップのパターン
//    hat: x=クローズ o=オープン / bass: x=ルート o=1オクターブ上 / stab: ブラスのキメ / chug: ギターの刻み
const CH = (root, notes) => ({ root, notes });
const SONGS = {
  // メニュー: クールなフュージョン
  menu: {
    bpm: 116, intro: 2, modulate: 0, leadStyle: 'epiano',
    kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.o.',
    bass: 'x..x.o.x..x.o.x.', bassLen: 1.2, chug: '................',
    parts: [{
      chords: [CH(38, [65, 69, 72, 76]), CH(43, [65, 71, 74, 77]), CH(48, [64, 67, 71, 76]), CH(45, [64, 67, 73, 76])],
      stab: '..........x.....',
      lead: [[[0, 77, 3], [3, 76, 3], [6, 74, 2], [8, 72, 6]], [[0, 71, 2], [2, 74, 2], [4, 77, 4], [8, 76, 8]],
        [[0, 76, 3], [3, 79, 3], [6, 83, 2], [8, 81, 6]], [[0, 79, 2], [2, 76, 2], [4, 73, 4], [8, 76, 8]]]
    }]
  },
  // NEON CIRCUIT: 明るく疾走するメジャーキーのフュージョンロック（D）
  neon: {
    bpm: 160, intro: 4, modulate: 2, leadStyle: 'brass',
    kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.o.',
    bass: 'x.ox.xo.x.ox.xo.', bassLen: 0.9, chug: '................',
    parts: [
      {
        chords: [CH(38, [62, 66, 69]), CH(36, [60, 64, 67]), CH(43, [62, 67, 71]), CH(45, [61, 64, 69])],
        stab: 'x..x..x.......x.',
        lead: [
          [[0, 74, 3], [3, 76, 3], [6, 78, 2], [8, 81, 6], [14, 78, 2]],
          [[0, 79, 3], [3, 78, 3], [6, 76, 2], [8, 72, 4], [12, 74, 4]],
          [[0, 74, 2], [2, 76, 2], [4, 79, 4], [8, 83, 3], [11, 81, 3], [14, 79, 2]],
          [[0, 81, 6], [6, 78, 2], [8, 76, 8]]
        ]
      },
      {
        chords: [CH(46, [62, 65, 70]), CH(48, [64, 67, 72]), CH(38, [62, 66, 69]), CH(38, [62, 66, 69])],
        stab: 'x.......x..x..x.', leadStyle: 'guitar',
        lead: [
          [[0, 82, 4], [4, 81, 2], [6, 79, 2], [8, 77, 4], [12, 79, 4]],
          [[0, 84, 4], [4, 83, 2], [6, 81, 2], [8, 79, 4], [12, 76, 4]],
          [[0, 78, 2], [2, 81, 2], [4, 86, 8], [12, 85, 2], [14, 83, 2]],
          [[0, 86, 12], [12, 81, 2], [14, 83, 2]]
        ]
      }
    ]
  },
  // SUNSET CANYON: 哀愁のハードロック（Em）
  canyon: {
    bpm: 168, intro: 4, modulate: 2, leadStyle: 'guitar',
    kick: 'x.x...x.x.x...x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.o.',
    bass: 'x.xxx.xxx.xxx.xo', bassLen: 0.9, chug: 'x.xxx.xxx.xxx.x.',
    parts: [
      {
        chords: [CH(40, [64, 67, 71]), CH(40, [64, 67, 71]), CH(36, [64, 67, 72]), CH(38, [62, 66, 69])],
        stab: '................',
        lead: [
          [[0, 76, 2], [2, 79, 2], [4, 81, 2], [6, 79, 2], [8, 83, 4], [12, 81, 2], [14, 79, 2]],
          [[0, 76, 6], [6, 74, 2], [8, 71, 8]],
          [[0, 72, 2], [2, 76, 2], [4, 79, 2], [6, 84, 2], [8, 83, 4], [12, 79, 4]],
          [[0, 81, 4], [4, 78, 4], [8, 74, 4], [12, 78, 4]]
        ]
      },
      {
        chords: [CH(36, [64, 67, 72]), CH(38, [62, 66, 69]), CH(47, [62, 66, 71]), CH(40, [64, 67, 71])],
        stab: 'x.....x.....x...', leadStyle: 'brass',
        lead: [
          [[0, 84, 4], [4, 83, 4], [8, 79, 4], [12, 76, 4]],
          [[0, 81, 4], [4, 83, 4], [8, 86, 8]],
          [[0, 83, 4], [4, 81, 2], [6, 79, 2], [8, 78, 4], [12, 74, 4]],
          [[0, 76, 12], [12, 79, 2], [14, 83, 2]]
        ]
      }
    ]
  },
  // STORM HIGHWAY: 緊迫感のある高速シンセロック（Cm）
  storm: {
    bpm: 174, intro: 4, modulate: 2, leadStyle: 'brass',
    kick: 'x..x..x.x..x..x.', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxox',
    bass: 'xxoxxxoxxxoxxxox', bassLen: 0.8, chug: 'x.x.x.x.x.x.x.x.',
    parts: [
      {
        chords: [CH(36, [60, 63, 67]), CH(44, [60, 63, 68]), CH(46, [58, 62, 65]), CH(43, [59, 62, 67])],
        stab: 'x.....x.....x...',
        lead: [
          [[0, 79, 1], [1, 80, 1], [2, 79, 2], [4, 75, 2], [6, 72, 2], [8, 75, 2], [10, 79, 2], [12, 84, 4]],
          [[0, 84, 2], [2, 82, 2], [4, 80, 4], [8, 79, 2], [10, 77, 2], [12, 75, 4]],
          [[0, 77, 2], [2, 79, 2], [4, 82, 4], [8, 86, 4], [12, 84, 4]],
          [[0, 83, 4], [4, 79, 4], [8, 74, 2], [10, 77, 2], [12, 79, 4]]
        ]
      },
      {
        chords: [CH(44, [60, 63, 68]), CH(46, [62, 65, 70]), CH(36, [60, 63, 67]), CH(36, [60, 63, 67])],
        stab: 'x..x..x...x..x..', leadStyle: 'guitar',
        lead: [
          [[0, 80, 4], [4, 79, 2], [6, 77, 2], [8, 75, 4], [12, 77, 4]],
          [[0, 82, 4], [4, 80, 2], [6, 79, 2], [8, 77, 4], [12, 74, 4]],
          [[0, 75, 2], [2, 79, 2], [4, 84, 8], [12, 82, 2], [14, 80, 2]],
          [[0, 84, 12], [12, 79, 4]]
        ]
      }
    ]
  },
  // VOID SPIRAL（高難度コース）: 不穏で超高速のメタル寄りロック（Bm）
  void: {
    bpm: 184, intro: 4, modulate: 1, leadStyle: 'guitar',
    kick: 'x.x...x.x.x...x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.',
    bass: 'xxxoxxxoxxxoxxxo', bassLen: 0.7, chug: 'xxx.xxx.xxx.xx.x',
    parts: [
      {
        chords: [CH(47, [62, 66, 71]), CH(48, [64, 67, 72]), CH(47, [62, 66, 71]), CH(45, [61, 64, 69])],
        stab: 'x..x..x.........',
        lead: [
          [[0, 83, 1], [1, 84, 1], [2, 83, 1], [3, 81, 1], [4, 79, 2], [6, 78, 2], [8, 79, 2], [10, 81, 2], [12, 83, 4]],
          [[0, 84, 2], [2, 83, 2], [4, 79, 4], [8, 76, 4], [12, 79, 4]],
          [[0, 83, 1], [1, 84, 1], [2, 83, 1], [3, 81, 1], [4, 79, 2], [6, 78, 2], [8, 76, 2], [10, 78, 2], [12, 79, 4]],
          [[0, 78, 4], [4, 73, 4], [8, 76, 4], [12, 81, 4]]
        ]
      },
      {
        chords: [CH(43, [62, 67, 71]), CH(45, [61, 64, 69]), CH(42, [61, 66, 70]), CH(47, [62, 66, 71])],
        stab: 'x.......x.......', leadStyle: 'brass', kick: 'x.x.x.x.x.x.x.x.',
        lead: [
          [[0, 86, 4], [4, 83, 4], [8, 79, 4], [12, 83, 4]],
          [[0, 85, 4], [4, 81, 4], [8, 76, 4], [12, 81, 4]],
          [[0, 82, 4], [4, 85, 4], [8, 90, 8]],
          [[0, 86, 12], [12, 83, 4]]
        ]
      }
    ]
  }
};
const music = { name: null, song: null, step: 0, nextTime: 0, intense: false };

function setMusic(name) {
  if (music.name === name) return;
  music.name = name;
  music.song = name ? SONGS[name] : null;
  music.step = 0;
  if (A.context) {
    music.nextTime = A.context.currentTime + 0.1;
    if (music.song) {
      const delayTime = (60 / music.song.bpm) * 0.75;
      A.delayL.delayTime.setTargetAtTime(delayTime, A.context.currentTime, 0.05);
      A.delayR.delayTime.setTargetAtTime(delayTime, A.context.currentTime, 0.05);
    }
  }
}
function syncMusic(now) {
  let name = null;
  if (selectingMachine) name = 'menu';
  else if (countdown.active) name = null;
  else if (paused) name = null;
  else if (car.status === 'racing') name = SONGS[course.music || course.id] ? (course.music || course.id) : 'neon';
  else name = now - finishAt < 3400 ? null : 'menu';
  setMusic(name);
  music.intense = car.status === 'racing' && !selectingMachine && completedLaps >= TOTAL_LAPS - 1;
}

function playLead(style, freq, at, duration, doubled) {
  if (style === 'guitar') {
    // 歪んだリードギター（しゃくり上げ＋ビブラート、2本で左右に広げる）
    [-7, 7].forEach((detune, i) => voice({
      type: 'sawtooth', freq, freqFrom: freq * 0.94, at, dur: duration, vol: 0.075, detune, drive: 7,
      cutoff: 3400, q: 1.4, attack: 0.004, release: 0.1, vibrato: duration > 0.2 ? freq * 0.012 : 0,
      pan: i ? 0.3 : -0.3, bus: 'duck', reverb: 0.22, echo: 0.12
    }));
  } else if (style === 'epiano') {
    voice({ type: 'sine', freq, at, dur: 0.04, vol: 0.12, release: Math.min(1.2, duration + 0.4), bus: 'duck', reverb: 0.35, echo: 0.25 });
    voice({ type: 'sine', freq: freq * 2, at, dur: 0.02, vol: 0.04, release: 0.3, bus: 'duck' });
    voice({ type: 'triangle', freq, at, dur: duration, vol: 0.04, cutoff: 2500, release: 0.2, bus: 'duck' });
  } else {
    // シンセブラス: 少し下からしゃくり上げ、フィルターがパッと開く厚い音＋1オクターブ下
    supersaw({
      freq, freqFrom: freq * 0.97, at, dur: duration, vol: 0.1, cutoff: 700, cutoffPeak: 6200, cutoffEnd: 2600, filterTime: 0.18, q: 1,
      attack: 0.012, release: 0.12, vibrato: duration > 0.2 ? freq * 0.01 : 0, bus: 'duck', reverb: 0.25, echo: 0.15, spread: 12
    });
    voice({ type: 'square', freq: freq / 2, at, dur: duration, vol: 0.03, cutoff: 1800, release: 0.1, bus: 'duck' });
  }
  if (doubled) voice({ type: 'square', freq: freq * 2, at, dur: duration, vol: 0.022, cutoff: 4500, release: 0.12, bus: 'duck', echo: 0.25 });
}

// 曲の進行: イントロ → [A 8小節 → B 8小節] を繰り返し、2周目ごとに modulate 半音ぶん転調
function songPosition(song, bar) {
  if (bar < song.intro) {
    const part = song.parts[0];
    return { part, chord: part.chords[bar % part.chords.length], transpose: 0, leadBar: null, inPart: -1 };
  }
  const k = bar - song.intro;
  const cycleLength = song.parts.length * 8;
  const cycle = Math.floor(k / cycleLength);
  const within = k % cycleLength;
  const part = song.parts[Math.floor(within / 8)];
  const inPart = within % 8;
  return {
    part, chord: part.chords[inPart % part.chords.length],
    transpose: (cycle % 2) * (song.modulate || 0), leadBar: inPart % 4, inPart
  };
}

function scheduleMusicStep(song, step, at, stepDuration) {
  const bar = Math.floor(step / 16);
  const s = step % 16;
  const pos = songPosition(song, bar);
  const part = pos.part;
  const chord = pos.chord;
  const tr = pos.transpose;
  const afterIntro = bar >= song.intro;
  const kick = part.kick || song.kick;

  // ---- ドラム ----
  if (kick[s] === 'x') {
    drumHit('kick', at, 1);
    A.musicDuck.gain.setValueAtTime(0.55, at);
    A.musicDuck.gain.linearRampToValueAtTime(1, at + Math.min(0.16, stepDuration * 3));
  }
  const sectionEnd = pos.inPart === 7 || (!afterIntro && bar === song.intro - 1);
  const smallFill = afterIntro && pos.inPart === 3;
  if (sectionEnd && s >= 8) {
    // セクションの変わり目はタム回し（高→中→低）
    if (s % 2 === 0) drumHit(s < 10 ? 'tomHigh' : (s < 13 ? 'tomMid' : 'tomLow'), at, 0.75, { pan: 0.4 - (s - 8) * 0.1, reverb: 0.2 });
    if (s >= 14) drumHit('snare', at, 0.7, { reverb: 0.25 });
  } else if (smallFill && s >= 12) {
    drumHit('snare', at, 0.3 + (s - 12) * 0.12, { reverb: 0.25 });
  } else {
    if (song.snare[s] === 'x') drumHit('snare', at, 0.72, { reverb: 0.3 });
    if (song.hat[s] === 'x') drumHit('hat', at, 0.24 + (s % 4 === 0 ? 0.06 : 0), { pan: 0.25 });
    if (song.hat[s] === 'o') drumHit('open', at, 0.2, { pan: 0.25 });
  }
  if (music.intense && s % 2 === 1) drumHit('hat', at, 0.16, { pan: -0.3 });
  if (s === 0 && afterIntro && pos.inPart === 0) drumHit('crash', at, 0.38, { reverb: 0.3, pan: -0.25 });
  else if (s === 0 && afterIntro && pos.inPart === 4) drumHit('crash', at, 0.22, { reverb: 0.25, pan: 0.25 });

  // ---- スラップベース ----
  const bassHit = song.bass[s];
  if (bassHit !== '.') {
    const freq = midiToFreq(chord.root + tr + (bassHit === 'o' ? 12 : 0));
    const length = stepDuration * song.bassLen;
    voice({ type: 'sine', freq, at, dur: length, vol: 0.28, release: 0.05, bus: 'duck' });
    voice({
      type: 'sawtooth', freq, at, dur: length, vol: bassHit === 'o' ? 0.2 : 0.16, cutoff: 300,
      cutoffPeak: bassHit === 'o' ? 3600 : 2000, cutoffEnd: 320, filterTime: 0.08, q: 5, release: 0.05, bus: 'duck'
    });
  }
  // ---- ギターの刻み ----
  if (song.chug[s] === 'x' && (afterIntro || s % 4 === 0)) {
    [chord.root + tr + 12, chord.root + tr + 19].forEach((note, i) => voice({
      type: 'sawtooth', freq: midiToFreq(note), at, dur: stepDuration * 0.65, vol: 0.055, drive: 7,
      cutoff: 1600, q: 1.1, release: 0.04, pan: i ? 0.55 : -0.55, bus: 'duck'
    }));
  }
  // ---- ブラスのキメ（裏拍に食い込むコード打ち） ----
  if (part.stab && part.stab[s] === 'x') {
    const long = part.stab[s + 1] === '.' && part.stab[s + 2] === '.' && part.stab[s + 3] === '.';
    chord.notes.slice(0, 3).forEach((note, i) => supersaw({
      freq: midiToFreq(note + tr), freqFrom: midiToFreq(note + tr) * 0.97, at,
      dur: stepDuration * (long ? 3 : 1.4), vol: 0.07, cutoff: 800, cutoffPeak: 5600, cutoffEnd: 1600,
      filterTime: 0.12, release: 0.12, pan: (i - 1) * 0.4, bus: 'duck', reverb: 0.25, spread: 10
    }));
  }
  // ---- パッド（和音を静かに支える） ----
  if (s === 0 && afterIntro) {
    chord.notes.slice(0, 3).forEach(note => voice({
      type: 'sawtooth', freq: midiToFreq(note + tr), at, dur: stepDuration * 15, vol: 0.012, detune: 8,
      cutoff: 1200, attack: 0.3, release: 0.4, bus: 'duck', reverb: 0.4
    }));
  }
  // ---- リード（パートの後半4小節はオクターブ上を重ねる） ----
  if (pos.leadBar !== null) {
    const melody = part.lead[pos.leadBar % part.lead.length];
    const doubled = pos.inPart >= 4;
    melody.forEach(([start, note, length]) => {
      if (start === s) playLead(part.leadStyle || song.leadStyle, midiToFreq(note + tr), at, stepDuration * length * 0.95, doubled);
    });
  }
}
function musicSchedulerTick() {
  if (!A.context || !music.song) return;
  const now = A.context.currentTime;
  if (music.nextTime < now - 0.2) music.nextTime = now + 0.05;
  while (music.nextTime < now + 0.15) {
    const stepDuration = 60 / (music.song.bpm * (music.intense ? 1.06 : 1)) / 4;
    scheduleMusicStep(music.song, music.step, music.nextTime, stepDuration);
    music.nextTime += stepDuration;
    music.step++;
  }
}
