// @ts-check
// ユーザーがいじれる仕組み（ガレージ・強化・オプション・傾き操作・一時停止・コースエディタ・タブ）
// ※ ファイルは index.html に書いた順に読み込まれ、変数や関数はファイル間で共有される
// ===================================================================
// ===== ユーザーがいじれる仕組み: ガレージ / オプション / コースエディタ =====
// ===================================================================
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// ---- ガレージ（色・エンジンの光・チューニング） ----
const BODY_COLORS = ['#0284c7', '#a855f7', '#f59e0b', '#10b981', '#e11d48', '#f8fafc', '#475569', '#facc15', '#06b6d4', '#ec4899', '#9a3412', '#111827'];
const GLOW_COLORS = ['#5fe3ff', '#f472b6', '#4ade80', '#fb923c', '#a78bfa', '#fde047', '#ffffff', '#ef4444'];
function machineCustom(id) {
  return garage[id] || {};
}
// チューニング（-100=加速重視 〜 +100=最高速重視）と操作感度を反映した性能
function effectiveMachine() {
  const base = currentMachine();
  const custom = machineCustom(base.id);
  const t = (custom.tune || 0) / 100;
  // 付けているパーツの効果（倍率）を、マシン本来の性能に掛け合わせる
  const parts = machineLoadout(base.id);
  const p = partMods(parts);
  return {
    ...base,
    top: base.top * (1 + 0.07 * t) * p.top,
    boostTop: base.boostTop * (1 + 0.04 * t) * p.boostTop,
    accel: base.accel * (1 - 0.35 * t) * p.accel,
    boostDrain: base.boostDrain * p.boostDrain,
    boostRegen: p.boostRegen,
    steer: base.steer * raceOptions.steer * p.steer,
    dori: base.dori * p.dori,
    doriWindow: DORI_MAX_INTERVAL + p.doriWindow,
    damage: base.damage * p.damage,
    impact: base.impact * p.impact,
    pitRate: p.pitRate,
    overloadLimit: OVERLOAD_LIMIT + p.overload,
    airGrip: p.airGrip,
    iceGrip: p.iceGrip,
    pull: p.pull,
    wallGuard: p.wallGuard,
    roughResist: p.roughResist,
    parts,
    color: custom.color || base.color,
    glow: custom.glow || GLOW_COLORS[0]
  };
}
function saveGarage(change) {
  const id = currentMachine().id;
  garage[id] = { ...machineCustom(id), ...change };
  writeStore('fzx-garage', garage);
  if (window.setHeroMachine) window.setHeroMachine(effectiveMachine());
  renderGarage();
}
function renderSwatches(container, colors, active, onPick, allowCustom) {
  container.innerHTML = '';
  colors.forEach(color => {
    const swatch = makeEl('button', `swatch${color === active ? ' active' : ''}`);
    swatch.type = 'button';
    swatch.style.background = color;
    swatch.setAttribute('aria-label', color);
    swatch.addEventListener('click', () => onPick(color));
    container.appendChild(swatch);
  });
  if (allowCustom) {
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = active;
    picker.title = '好きな色を選ぶ';
    picker.addEventListener('change', () => onPick(picker.value));
    container.appendChild(picker);
  }
}
function renderGarage() {
  const base = currentMachine();
  const custom = machineCustom(base.id);
  const machineNow = effectiveMachine();
  document.getElementById('garageMachineName').textContent = `— ${base.name}`;
  renderSwatches(document.getElementById('bodySwatches'), BODY_COLORS, machineNow.color, color => saveGarage({ color }), true);
  renderSwatches(document.getElementById('glowSwatches'), GLOW_COLORS, machineNow.glow, glow => saveGarage({ glow }), false);
  const tune = custom.tune || 0;
  const range = /** @type {HTMLInputElement} */ (document.getElementById('tuneRange'));
  if (Number(range.value) !== tune) range.value = tune;
  document.getElementById('tuneText').textContent = tune === 0 ? '標準' : (tune < 0 ? `加速重視 ${-tune}%` : `最高速重視 ${tune}%`);
  document.getElementById('tunePreview').textContent =
    `最高速 ${Math.round(15 * machineNow.top * 22)} km/h ／ ブースト ${Math.round(24 * machineNow.boostTop * 22)} km/h ／ 加速 ×${(machineNow.accel / base.accel).toFixed(2)}`;
  renderParts();
}
document.getElementById('tuneRange').addEventListener('input', event => saveGarage({ tune: Number(/** @type {HTMLInputElement} */ (event.target).value) }));
document.getElementById('garageReset').addEventListener('click', () => {
  delete garage[currentMachine().id];
  writeStore('fzx-garage', garage);
  if (window.setHeroMachine) window.setHeroMachine(effectiveMachine());
  renderGarage();
  playCue('ui');
});

// ---- パーツ（ポイントで購入してマシンに装着。持っているパーツは全マシン共通で使える） ----
let garageSel = null;   // 説明を表示中のパーツ { slot, id }
function canBuyPart() {
  return PARTS.some(part => !progress.owned.includes(part.id) && progress.points >= part.price);
}
function updatePointsBadges() {
  const garagePoints = document.getElementById('garagePoints');
  const setupPoints = document.getElementById('setupPoints');
  if (garagePoints) garagePoints.textContent = `${progress.points} PT`;
  if (setupPoints) setupPoints.textContent = `${progress.points}PT${canBuyPart() ? ' ▲' : ''}`;
}
// 性能の変化を「+5%」のように表示する（2つ目が true の項目は、数字が小さいほど良い）
const MOD_LABELS = {
  top: ['最高速'], accel: ['加速'], boostTop: ['ブースト速度'], boostDrain: ['ブースト消費', true], boostRegen: ['ブースト回復'],
  steer: ['旋回'], dori: ['ドリドリの伸び'], damage: ['被ダメージ', true], impact: ['接触の衝撃', true], pitRate: ['PIT回復'],
  airGrip: ['空中の操作'], iceGrip: ['氷上グリップ'], pull: ['カーブで流される量', true], wallGuard: ['壁での減速', true],
  roughResist: ['荒れ地での減速', true]
};
function describeMods(mods) {
  return Object.entries(mods).map(([key, value]) => {
    if (key === 'overload') return `<span class="up">エネルギー0の粘り +${value}</span>`;
    if (key === 'doriWindow') return `<span class="up">切り返しの猶予 +${value}</span>`;
    const [label, lower] = MOD_LABELS[key] || [key];
    const pct = Math.round((value - 1) * 100);
    const good = lower ? pct < 0 : pct > 0;
    return `<span class="${good ? 'up' : 'down'}">${label} ${pct > 0 ? '+' : ''}${pct}%</span>`;
  }).join(' ');
}
// パーツを付けたことによる総合的な変化（パーツなしと比べて）
function statSummary(mods) {
  const stats = [
    ['最高速', mods.top], ['加速', mods.accel], ['ブースト', mods.boostTop], ['燃費', 1 / mods.boostDrain],
    ['旋回', mods.steer], ['安定', 1 / mods.pull], ['耐久', 1 / mods.damage]
  ];
  const box = makeEl('div', 'stat-chips');
  stats.forEach(([label, value]) => {
    const pct = Math.round((value - 1) * 100);
    box.appendChild(makeEl('span', pct > 0 ? 'up' : (pct < 0 ? 'down' : ''), `${label} ${pct > 0 ? '+' : ''}${pct}%`));
  });
  return box;
}
function renderParts(flashSlot) {
  updatePointsBadges();
  const base = currentMachine();
  const loadout = machineLoadout(base.id);
  const cap = MACHINE_CAPACITY[base.id] || 9;
  const used = loadoutLoad(loadout);
  const list = document.getElementById('partList');
  list.innerHTML = '';
  const meter = makeEl('div', `load-meter${used >= cap ? ' full' : ''}`);
  meter.innerHTML = `<span>積載 <b>${used}</b> / ${cap}（${escapeHtml(base.name)}）</span><i><em style="width:${clamp(used / cap, 0, 1) * 100}%"></em></i>`;
  list.appendChild(meter);
  PART_SLOTS.forEach(slot => {
    const row = makeEl('div', `part-slot${slot.key === flashSlot ? ' flash' : ''}`);
    row.appendChild(makeEl('div', 'part-slot-name', slot.name));
    const choices = makeEl('div', 'choice-row part-choices');
    [null, ...PARTS.filter(part => part.slot === slot.key)].forEach(part => {
      const id = part ? part.id : null;
      const equipped = (loadout[slot.key] || null) === id;
      const owned = !part || progress.owned.includes(part.id);
      const selected = Boolean(garageSel) && garageSel.slot === slot.key && garageSel.id === id;
      const button = makeEl('button', [equipped ? 'active' : '', owned ? '' : 'locked', selected ? 'sel' : ''].join(' ').trim());
      button.type = 'button';
      button.innerHTML = part
        ? `${escapeHtml(part.name)}<small>${owned ? `負荷 ${part.load}` : `🔒 ${part.price}pt`}</small>`
        : 'なし<small>標準</small>';
      button.addEventListener('click', () => {
        garageSel = selected ? null : { slot: slot.key, id };
        playCue('ui');
        renderParts();
      });
      choices.appendChild(button);
    });
    row.appendChild(choices);
    if (garageSel && garageSel.slot === slot.key) row.appendChild(partDetail(slot.key, garageSel.id, loadout, cap, used));
    list.appendChild(row);
  });
  list.appendChild(statSummary(partMods(loadout)));
  const refund = progress.owned.reduce((sum, id) => sum + partById(id).price, 0);
  const resetButton = /** @type {HTMLButtonElement} */ (document.getElementById('partReset'));
  resetButton.disabled = refund === 0;
  resetButton.textContent = refund ? `パーツを全部売る（${refund}pt 返還）` : 'パーツを全部売る（未購入）';
  delete resetButton.dataset.armed;
  // パーツを選んだら、説明と購入ボタンが画面に収まるところまで自動でスクロールする
  const detail = /** @type {HTMLElement | null} */ (list.querySelector('.part-detail'));
  if (detail) revealInSetup(detail);
}
// 選んだパーツの説明と、購入・装着ボタン
function partDetail(slotKey, id, loadout, cap, used) {
  const part = id ? partById(id) : null;
  const current = loadout[slotKey] ? partById(loadout[slotKey]) : null;
  const usedAfter = used - (current ? current.load : 0) + (part ? part.load : 0);
  const owned = !part || progress.owned.includes(part.id);
  const equipped = (loadout[slotKey] || null) === id;
  const box = makeEl('div', 'part-detail');
  box.appendChild(makeEl('div', 'part-desc', part ? `${part.name}（負荷 ${part.load}）: ${part.desc}` : '何も付けない（標準の性能）'));
  if (part) {
    const effect = makeEl('div', 'part-effect');
    effect.innerHTML = describeMods(part.mods);
    box.appendChild(effect);
  }
  const action = /** @type {HTMLButtonElement} */ (makeEl('button', 'small-btn primary'));
  action.type = 'button';
  if (equipped) {
    action.textContent = id ? '装着中' : '何も付けていません';
    action.disabled = true;
  } else if (usedAfter > cap) {
    action.textContent = `積載オーバー（${usedAfter} / ${cap}）。他のパーツを外してください`;
    action.disabled = true;
  } else if (!owned) {
    action.textContent = progress.points >= part.price ? `${part.price}pt で購入して装着` : `ポイント不足（あと ${part.price - progress.points}pt）`;
    action.disabled = progress.points < part.price;
  } else {
    action.textContent = id ? '装着する' : '外す';
  }
  action.addEventListener('click', () => equipPart(slotKey, id));
  box.appendChild(action);
  return box;
}
function equipPart(slotKey, id) {
  const base = currentMachine();
  const part = id ? partById(id) : null;
  const loadout = machineLoadout(base.id);
  const current = loadout[slotKey] ? partById(loadout[slotKey]) : null;
  const cap = MACHINE_CAPACITY[base.id] || 9;
  if (loadoutLoad(loadout) - (current ? current.load : 0) + (part ? part.load : 0) > cap) {
    playCue('deny');
    return;
  }
  let bought = false;
  if (part && !progress.owned.includes(part.id)) {
    if (progress.points < part.price) {
      playCue('deny');
      return;
    }
    progress.points -= part.price;
    progress.owned.push(part.id);
    bought = true;
  }
  if (part) loadout[slotKey] = part.id;
  else delete loadout[slotKey];
  progress.loadouts[base.id] = loadout;
  saveProgress();
  playCue(bought ? 'upgrade' : 'ok');
  if (window.setHeroMachine) window.setHeroMachine(effectiveMachine());
  renderGarage();
  renderParts(slotKey);
}
// 全部売る（買った値段を全額返す）。誤操作を防ぐため2回押しで実行
document.getElementById('partReset').addEventListener('click', event => {
  const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
  if (!button.dataset.armed) {
    button.dataset.armed = '1';
    button.textContent = 'もう一度押すと全部売ります';
    playCue('ui');
    setTimeout(() => { if (button.dataset.armed) renderParts(); }, 3000);
    return;
  }
  progress.points += progress.owned.reduce((sum, id) => sum + partById(id).price, 0);
  progress.owned = [];
  progress.loadouts = {};
  garageSel = null;
  saveProgress();
  playCue('points');
  if (window.setHeroMachine) window.setHeroMachine(effectiveMachine());
  renderGarage();
});

// ---- 汎用の入力部品（選択ボタン・スライダー・文字入力） ----
function buildField(def, value, onInput, onCommit) {
  const field = makeEl('div', 'field');
  const label = makeEl('label');
  label.appendChild(document.createTextNode(def.label));
  const valueText = makeEl('span', 'value');
  label.appendChild(valueText);
  field.appendChild(label);
  const show = v => { valueText.textContent = def.format ? def.format(v) : ''; };
  if (def.type === 'choice') {
    const row = makeEl('div', 'choice-row');
    def.choices.forEach(([choiceValue, text]) => {
      const button = makeEl('button', choiceValue === value ? 'active' : '', text);
      button.type = 'button';
      button.addEventListener('click', () => {
        row.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === button));
        onInput(choiceValue);
        if (onCommit) onCommit(choiceValue);
      });
      row.appendChild(button);
    });
    field.appendChild(row);
  } else if (def.type === 'range') {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = def.min; input.max = def.max; input.step = def.step;
    input.value = value;
    input.addEventListener('input', () => { show(Number(input.value)); onInput(Number(input.value)); });
    if (onCommit) input.addEventListener('change', () => onCommit(Number(input.value)));
    field.appendChild(input);
  } else {
    const input = document.createElement('input');
    input.type = def.type === 'number' ? 'number' : 'text';
    if (def.maxLength) input.maxLength = def.maxLength;
    input.value = value;
    input.addEventListener('input', () => onInput(def.type === 'number' ? Number(input.value) : input.value));
    if (onCommit) input.addEventListener('change', () => onCommit(input.value));
    field.appendChild(input);
  }
  show(value);
  return field;
}

// ---- オプション ----
const OPTION_DEFS = [
  { key: 'laps', label: '周回数', type: 'choice', choices: [[1, '1周'], [2, '2周'], [3, '3周'], [5, '5周']] },
  { key: 'rivals', label: 'ライバルの数', type: 'choice', choices: [[0, 'なし'], [5, '5台'], [10, '10台'], [15, '15台']] },
  { key: 'difficulty', label: '難易度（ライバルの速さ）', type: 'choice', choices: [[0.9, 'EASY'], [1, 'NORMAL'], [1.06, 'HARD'], [1.12, 'MASTER']] },
  { key: 'control', label: 'スマホの操作', type: 'choice', choices: [['buttons', 'ボタン'], ['tilt', '傾けて曲がる']] },
  { key: 'autoAccel', label: 'オートアクセル（GOボタンがブレーキになる）', type: 'choice', choices: [[true, 'ON'], [false, 'OFF']] },
  { key: 'steer', label: 'ハンドル感度', type: 'range', min: 0.6, max: 1.5, step: 0.05, format: v => `×${v.toFixed(2)}` },
  { key: 'tiltRange', label: '傾きの量（ハンドルを最大まで切る角度。小さいほど敏感）', type: 'range', min: 6, max: 30, step: 1, format: v => `${v}°` },
  { key: 'touchLift', label: 'スマホのボタンの位置（下の表示と重なる場合は上げる）', type: 'choice', choices: [[0, '標準'], [50, '少し上'], [100, '上']] },
  { key: 'quality', label: '画質', type: 'choice', choices: [['high', '高画質'], ['low', '軽量（スマホ向け）']] }
];
function renderOptions() {
  const container = document.getElementById('optionControls');
  container.innerHTML = '';
  OPTION_DEFS.forEach(def => {
    container.appendChild(buildField(def, raceOptions[def.key], value => {
      raceOptions[def.key] = value;
      writeStore('fzx-options', raceOptions);
      if (def.key === 'control' && value === 'tilt') enableTilt();
      if (def.key === 'control' && value === 'buttons') tilt.active = false;
      applyOptions();
    }));
  });
}
// 操作方法・画質などを画面に反映
function applyOptions() {
  wrapEl.classList.toggle('tilt-mode', raceOptions.control === 'tilt' && tilt.active);
  wrapEl.style.setProperty('--touch-lift', `${raceOptions.touchLift || 0}px`);
  const controlToggle = document.getElementById('controlToggle');
  controlToggle.textContent = raceOptions.control === 'tilt' ? '🎮 操作: 傾けて曲がる' : '🎮 操作: ボタン';
  controlToggle.classList.toggle('tilt', raceOptions.control === 'tilt');
  document.getElementById('bGas').textContent = raceOptions.autoAccel ? 'BRAKE' : 'GO';
  let help;
  if (IS_TOUCH) {
    const steerText = raceOptions.control === 'tilt' && tilt.active ? 'スマホを傾けて旋回' : '◀ ▶ で旋回';
    const accelText = raceOptions.autoAccel ? 'アクセル自動・BRAKEで減速（GO直前にBOOSTでロケットスタート）' : 'GOでアクセル';
    help = `${steerText} / ${accelText} / BOOST 加速 / DRIFT＋左右交互 ドリドリ`;
  } else {
    const accelText = raceOptions.autoAccel ? 'アクセル自動・Z ブレーキ' : 'Z アクセル';
    help = `← → 旋回 / ${accelText} / Space ブースト / Shift+左右交互 ドリドリ / Esc 一時停止`;
  }
  controlsHintEl.innerHTML = `${help}<br>ENERGYは壁・接触・地雷で減る → PIT(緑のレーン)で回復。0の状態で被弾するとリタイア`;
  if (window.setRenderQuality) window.setRenderQuality(raceOptions.quality);
}

// ---- 傾き操作（スマホを左右に傾けて曲がる） ----
// iPhone だけにある許可の確認（requestPermission）は標準の型にないので any として扱う
/** @type {any} */
const MotionEventAPI = window.DeviceMotionEvent;
/** @type {any} */
const OrientationEventAPI = window.DeviceOrientationEvent;
// ハンドルのように画面と同じ面で回すと、端末から見た重力の向き（画面の面内の成分）が回る。
// スタート時の重力の向きを「まっすぐ」として、そこから何度回ったかをハンドル量にする。
// 画面の向き（縦/横）やiPhone/Androidの符号の違いに左右されない（どちらでも右に回すと＋になる）
function onDeviceMotion(event) {
  const g = event.accelerationIncludingGravity;
  tilt.motionEvents = (tilt.motionEvents || 0) + 1;
  if (!g || g.x === null || g.y === null || g.x === undefined) return;
  tilt.motionValid = (tilt.motionValid || 0) + 1;
  tilt.motionAt = performance.now();
  applyGravity(g.x, g.y, 'motion');
}
// 予備: 「向きのセンサー」（beta/gamma）から重力の向きを計算する。
// アプリ内ブラウザなど、動きのセンサーが届かない環境向け（動きのセンサーが来ている間は使わない）
function onDeviceOrientation(event) {
  tilt.orientEvents = (tilt.orientEvents || 0) + 1;
  tilt.lastBeta = event.beta;
  tilt.lastGamma = event.gamma;
  if (event.beta === null || event.gamma === null || event.beta === undefined) return;
  // 動きのセンサーが一度でも届いたら、以後は向きのセンサーを使わない
  // （iPhoneは2つのセンサーで重力の符号が逆。混ぜると1回目のレースでハンドルが左右逆になっていた）
  if (tilt.motionValid) return;
  const b = event.beta * Math.PI / 180, g = event.gamma * Math.PI / 180;
  applyGravity(-Math.cos(b) * Math.sin(g) * 9.81, Math.sin(b) * 9.81, 'orient');
}
function applyGravity(gx, gy, source) {
  tilt.supported = true;
  tilt.lastEvent = performance.now();
  const g = { x: gx, y: gy };
  const magnitude = Math.hypot(g.x, g.y);
  if (magnitude < 2.5) return;   // 端末をほぼ水平に寝かせていると向きが定まらない
  const cx = g.x / magnitude, cy = g.y / magnitude;
  // 今の持ち方をまっすぐ（中心）にする。中心を測ったセンサーと違うセンサーの値が来たら測り直す
  if (tilt.needsCalibration || !tilt.cal || tilt.calSource !== source) {
    tilt.cal = { x: cx, y: cy };
    tilt.calSource = source;
    tilt.needsCalibration = false;
  }
  const cross = tilt.cal.x * cy - tilt.cal.y * cx;
  const dot = tilt.cal.x * cx + tilt.cal.y * cy;
  const degrees = Math.atan2(cross, dot) * 180 / Math.PI;
  // 手ぶれ程度（約1.5°）は無視し、そこから「傾きの量」の角度で最大まで切れる。
  // 少し傾けただけでも効くよう、小さい角度を強めに反映する
  const usable = Math.max(0, Math.abs(degrees) - 1.5) / Math.max(4, raceOptions.tiltRange - 1.5);
  let value = Math.sign(degrees) * Math.pow(Math.min(1, usable), 0.8);
  tilt.raw = clamp(value, -1, 1);
}
function tiltFailed(message) {
  tilt.active = false;
  applyOptions();
  showToast(message, 'bad', 3800);
}
function enableTilt() {
  const begin = () => {
    if (!tilt.listening) {
      addEventListener('devicemotion', onDeviceMotion);
      addEventListener('deviceorientation', onDeviceOrientation);
      tilt.listening = true;
    }
    tilt.active = true;
    tilt.needsCalibration = true;
    applyOptions();
    setTimeout(() => {
      if (tilt.active && !tilt.supported) {
        tiltFailed('傾きセンサーの値が届きません。LINEなどのアプリ内ブラウザでは使えないことがあるので、Safari / Chrome で開いてください（ボタン操作に切り替えます）');
      }
    }, 2500);
  };
  if (typeof DeviceMotionEvent === 'undefined' && typeof DeviceOrientationEvent === 'undefined') {
    tiltFailed('この端末では傾き操作が使えません');
    return;
  }
  // iPhone: タップした操作の中で許可を求める。動きと向きは同じ許可なので、確認は1回だけにする
  // （2回同時に求めると、2回目が確認画面なしで「拒否」になることがある）
  const asks = [];
  if (typeof DeviceMotionEvent !== 'undefined' && typeof MotionEventAPI.requestPermission === 'function') {
    asks.push(MotionEventAPI.requestPermission());
  } else if (typeof DeviceOrientationEvent !== 'undefined' && typeof OrientationEventAPI.requestPermission === 'function') {
    asks.push(OrientationEventAPI.requestPermission());
  }
  if (!asks.length) {
    tilt.permission = '不要（この端末は許可なしで使える）';
    begin();
    return;
  }
  tilt.permission = '確認中…';
  Promise.allSettled(asks).then(results => {
    tilt.permission = results.map(r => (r.status === 'fulfilled' ? r.value : `エラー: ${r.reason && r.reason.name}`)).join(' / ');
    if (results.some(r => r.status === 'fulfilled' && r.value === 'granted')) begin();
    else tiltFailed('傾きセンサーが拒否されました。Safariを完全に閉じて（上にスワイプして終了）開き直し、確認が出たら「許可」を押してください');
  });
}
// 毎フレーム: なめらかにしてハンドル量へ。メーター表示も更新
function updateTilt() {
  if (!tilt.active) return;
  tilt.value += (tilt.raw - tilt.value) * 0.5;
  // 画面のハンドルを、スマホを回した角度と同じだけ回す
  tiltWheel.style.transform = `rotate(${tilt.value * raceOptions.tiltRange}deg)`;
  // センサーの状態を表示（値が来ていない／止まっているのが分かるように）
  const fresh = tilt.supported && performance.now() - tilt.lastEvent < 1000;
  tiltMeterEl.classList.toggle('waiting', !fresh);
  tiltLabel.textContent = fresh ? `ハンドル ${tilt.value > 0.05 ? '右' : (tilt.value < -0.05 ? '左' : '')} ${Math.round(Math.abs(tilt.value) * 100)}%` : 'センサー待ち…';
}
const tiltWheel = document.getElementById('tiltWheel');
const tiltMeterEl = document.getElementById('tiltMeter');
const tiltLabel = document.querySelector('#tiltMeter span');

// ---- 一時停止・全画面 ----
const pauseOverlay = document.getElementById('pauseOverlay');
function renderPauseButtons() {
  pauseOverlay.querySelector('[data-pause="bgm"]').textContent = `♪ BGM: ${audioSettings.bgm ? 'ON' : 'OFF'}`;
  pauseOverlay.querySelector('[data-pause="se"]').textContent = `🔊 SE: ${audioSettings.se ? 'ON' : 'OFF'}`;
  pauseOverlay.querySelector('[data-pause="control"]').textContent = `操作: ${raceOptions.control === 'tilt' ? '傾き' : 'ボタン'}`;
  /** @type {HTMLElement} */ (pauseOverlay.querySelector('[data-pause="calibrate"]')).hidden = !(raceOptions.control === 'tilt' && tilt.active);
}
function setPaused(on) {
  if (on === paused) return;
  if (on) {
    if (selectingMachine || !raceHud.overlay.hidden) return;
    paused = true;
    pausedAt = performance.now();
    releaseAllInputs();
    renderPauseButtons();
    pauseOverlay.hidden = false;
    applyAudioSettings();
  } else {
    // 止まっていた時間ぶん、タイム計測の基準をずらす
    const pausedFor = performance.now() - pausedAt;
    raceStartedAt += pausedFor;
    lapStartedAt += pausedFor;
    countdown.startAt += pausedFor;
    if (finishAt !== null) finishAt += pausedFor;
    if (resultsAt !== null) resultsAt += pausedFor;
    paused = false;
    pauseOverlay.hidden = true;
    applyAudioSettings();
    lastFrameAt = performance.now();
  }
}
function closePause() {
  paused = false;
  pauseOverlay.hidden = true;
  applyAudioSettings();
}
pauseOverlay.addEventListener('click', event => {
  const target = /** @type {HTMLElement} */ (event.target);
  const action = target.dataset && target.dataset.pause;
  if (!action) return;
  if (action === 'resume') setPaused(false);
  if (action === 'retry') { closePause(); beginRace(); }
  if (action === 'menu') { closePause(); gp.active = false; openSetup(); }
  if (action === 'bgm' || action === 'se') toggleAudio(action);
  if (action === 'control') {
    raceOptions.control = raceOptions.control === 'tilt' ? 'buttons' : 'tilt';
    writeStore('fzx-options', raceOptions);
    if (raceOptions.control === 'tilt') enableTilt();
    else tilt.active = false;
    applyOptions();
    renderOptions();
  }
  if (action === 'calibrate') {
    tilt.needsCalibration = true;
    showToast('今の持ち方を「まっすぐ」にしました', 'good', 1600);
  }
  if (action === 'fullscreen') toggleFullscreen();
  if (action === 'flip') flipPortraitRotation();
  renderPauseButtons();
});
document.getElementById('pauseBtn').addEventListener('click', () => setPaused(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && car.status === 'racing' && !selectingMachine) setPaused(true);
});
function toggleFullscreen() {
  const doc = document;
  const el = doc.documentElement;
  if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) {
      showToast('この端末は全画面に非対応です（ホーム画面に追加すると広く遊べます）', 'bad', 3000);
      return;
    }
    Promise.resolve(request.call(el))
      .then(() => {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      })
      .catch(() => {});
  } else {
    (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
  }
}
document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);
document.getElementById('flipBtn').addEventListener('click', flipPortraitRotation);
// ---- 傾きセンサーの診断（スマホの画面で、どこで止まっているかを確認できるようにする） ----
const APP_VERSION = '2026-11-22 v14';
let tiltDiagTimer = null;
function renderTiltDiag() {
  const ua = navigator.userAgent;
  const inApp = /Line\/|FBAN|FBAV|Instagram|Twitter|MicroMessenger|KAKAOTALK/i.test(ua);
  const hasMotion = typeof DeviceMotionEvent !== 'undefined';
  const hasOrient = typeof DeviceOrientationEvent !== 'undefined';
  const needPerm = (hasMotion && typeof MotionEventAPI.requestPermission === 'function')
    || (hasOrient && typeof OrientationEventAPI.requestPermission === 'function');
  const fmt = v => (typeof v === 'number' ? v.toFixed(1) : String(v));
  let verdict;
  if (!window.isSecureContext) verdict = '× https で開いていません。https:// のURLで開いてください';
  else if (inApp) verdict = '× アプリ内ブラウザです。Safari / Chrome で開き直してください';
  else if (!hasMotion && !hasOrient) verdict = '× この端末・ブラウザは傾きセンサーに対応していません';
  else if (tilt.permission && /denied|エラー/.test(tilt.permission)) verdict = '× 拒否されています。Safariを完全に終了して開き直し、このボタンを押して出る確認で「許可」を選んでください（以前「許可しない」を選ぶと、確認が出ずに拒否されます）';
  else if (!(tilt.motionEvents || tilt.orientEvents)) verdict = '… センサーの値を待っています（届かない場合はブラウザがブロックしています）';
  else if (!tilt.supported) verdict = '△ センサーは反応していますが値が空です（この端末では使えない可能性）';
  else verdict = '○ 正常です。スマホをハンドルのように左右に回すと下の％が変わります';
  document.getElementById('tiltDiag').textContent = [
    `バージョン: ${APP_VERSION}`,
    `接続: ${window.isSecureContext ? 'https OK' : 'https ではない'}  /  ブラウザ: ${inApp ? 'アプリ内ブラウザ' : '通常'}`,
    `センサー機能: 動き ${hasMotion ? 'あり' : 'なし'} / 向き ${hasOrient ? 'あり' : 'なし'} / 許可の確認 ${needPerm ? '必要' : '不要'}`,
    `許可の結果: ${tilt.permission || '未確認'}`,
    `動きセンサー: ${tilt.motionEvents || 0}回 受信（有効 ${tilt.motionValid || 0}）`,
    `向きセンサー: ${tilt.orientEvents || 0}回 受信（前後 ${fmt(tilt.lastBeta)} / 左右 ${fmt(tilt.lastGamma)}）`,
    `ハンドル: ${tilt.active ? `${tilt.value >= 0 ? '右' : '左'} ${Math.round(Math.abs(tilt.value) * 100)}%` : '傾き操作は OFF'}`,
    `判定: ${verdict}`
  ].join('\n');
}
document.getElementById('tiltTest').addEventListener('click', () => {
  raceOptions.control = 'tilt';
  writeStore('fzx-options', raceOptions);
  enableTilt();   // ボタンを押したこの瞬間に許可を求める（iPhoneの決まり）
  renderOptions();
  clearInterval(tiltDiagTimer);
  const until = performance.now() + 60000;
  tiltDiagTimer = setInterval(() => {
    updateTilt();
    renderTiltDiag();
    if (performance.now() > until) clearInterval(tiltDiagTimer);
  }, 150);
  renderTiltDiag();
});

// ③マシン画面の操作切り替え（タップした瞬間にセンサーの許可を求める）
document.getElementById('controlToggle').addEventListener('click', () => {
  raceOptions.control = raceOptions.control === 'tilt' ? 'buttons' : 'tilt';
  writeStore('fzx-options', raceOptions);
  if (raceOptions.control === 'tilt') {
    enableTilt();
    showToast('傾き操作: スタート時の持ち方が「まっすぐ」。ハンドルのように左右に回して曲がります', 'good', 3600);
  } else {
    tilt.active = false;
  }
  applyOptions();
  playCue('ui');
});
document.getElementById('soundTest').addEventListener('click', () => {
  startAudio();
  setTimeout(() => {
    if (!A.context) {
      showToast('このブラウザでは音を鳴らせません', 'bad', 2600);
      return;
    }
    playCue('finish');
    const state = A.context.state === 'running' ? '再生中' : `停止中（${A.context.state}）`;
    const hint = !audioSettings.se ? ' / SEがOFFです' : '';
    showToast(`ファンファーレが聞こえればOK（音声: ${state}${hint}）。聞こえないときは本体の音量と消音スイッチを確認`, 'good', 4200);
  }, 150);
});

// ---- コースエディタ ----
const EDITOR_DEFAULT = {
  name: 'MY COURSE', theme: 'neon', length: 8000, curve: 0.8, complexity: 4, hills: 1,
  dash: 2, jump: 1, slip: 0, rough: 1, norail: 2, mines: 6, pit: true, seed: 2024
};
const EDITOR_DEFS = [
  { key: 'name', label: 'コース名', type: 'text', maxLength: 18 },
  { key: 'theme', label: '景色と曲', type: 'choice', choices: [['neon', 'NEON'], ['canyon', 'CANYON'], ['storm', 'STORM'], ['void', 'VOID']] },
  { key: 'length', label: 'コースの長さ', type: 'range', min: 6000, max: 11000, step: 250, format: v => `${(v / 1000).toFixed(2)}km` },
  { key: 'curve', label: 'カーブの強さ', type: 'range', min: 0.2, max: 1.6, step: 0.05, format: v => `${Math.round(v * 100)}%` },
  { key: 'complexity', label: 'カーブの細かさ', type: 'range', min: 1, max: 7, step: 1, format: v => `${v}` },
  { key: 'hills', label: '起伏', type: 'range', min: 0, max: 2, step: 0.1, format: v => `${Math.round(v * 100)}%` },
  { key: 'dash', label: 'ダッシュ', type: 'range', min: 0, max: 4, step: 1, format: v => `${v}個` },
  { key: 'jump', label: 'ジャンプ台', type: 'range', min: 0, max: 3, step: 1, format: v => `${v}個` },
  { key: 'slip', label: '凍結路面', type: 'range', min: 0, max: 2, step: 1, format: v => `${v}個` },
  { key: 'rough', label: '荒れ地', type: 'range', min: 0, max: 2, step: 1, format: v => `${v}個` },
  { key: 'norail', label: 'ガードレールなし', type: 'range', min: 0, max: 5, step: 1, format: v => `${v}区間` },
  { key: 'mines', label: '地雷', type: 'range', min: 0, max: 24, step: 1, format: v => `${v}個` },
  { key: 'pit', label: 'ピット', type: 'choice', choices: [[true, 'あり'], [false, 'なし']] },
  { key: 'seed', label: '形の番号（変えると別の形）', type: 'number' }
];
function sanitizeEditorParams(input) {
  const out = { ...EDITOR_DEFAULT };
  EDITOR_DEFS.forEach(def => {
    const value = input[def.key];
    if (value === undefined || value === null) return;
    if (def.type === 'range') out[def.key] = clamp(Number(value) || 0, def.min, def.max);
    else if (def.type === 'choice') out[def.key] = def.choices.some(([v]) => v === value) ? value : EDITOR_DEFAULT[def.key];
    else if (def.type === 'number') out[def.key] = Math.abs(Math.floor(Number(value) || 1)) % 1000000;
    else out[def.key] = String(value).slice(0, def.maxLength || 18);
  });
  return out;
}
let editorParams = sanitizeEditorParams(readStore('fzx-editor', EDITOR_DEFAULT));
let customCourse = null;

// 番号から毎回同じ乱数列を作る（同じ設定なら同じコースになる）
function seededRandom(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
// 設定からコースを組み立てる
function generateCourse(p) {
  const rng = seededRandom(p.seed + 7);
  const lap = p.length;
  // 曲がり: 波の数（細かさ）を重ね、強さ×長さで全体の曲がる量をそろえる
  const used = new Set();
  const terms = [];
  for (let k = 0; k < p.complexity; k++) {
    let harmonic = k + 1 + (k >= 2 ? Math.floor(rng() * 3) : 0);
    while (used.has(harmonic)) harmonic++;
    used.add(harmonic);
    terms.push([0.4 + rng() * 0.6, harmonic, rng() * Math.PI * 2]);
  }
  const bend = terms.reduce((sum, [amp, harmonic]) => sum + amp * harmonic, 0);
  const scale = (0.062 * lap * p.curve) / bend;
  const curve = terms.map(([amp, harmonic, phase]) => [Math.round(amp * scale * 10) / 10, harmonic, Math.round(phase * 100) / 100]);
  const elev = [
    [Math.round(30 * p.hills), 2 + Math.floor(rng() * 2), Math.round(rng() * 600) / 100],
    [Math.round(10 * p.hills), 5 + Math.floor(rng() * 3), Math.round(rng() * 600) / 100]
  ];

  // ギミック: 種類ごとの個数を並べ替えて、スタート直後とゴール直前を避けて順に配置
  const requests = [];
  const add = (type, n) => { for (let i = 0; i < n; i++) requests.push(type); };
  add('dash', p.dash); add('jump', p.jump); add('slip', p.slip); add('rough', p.rough); add('norail', p.norail);
  if (p.pit) requests.push('pit');
  for (let i = requests.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [requests[i], requests[j]] = [requests[j], requests[i]];
  }
  const LENGTHS = { dash: [300, 450], jump: [650, 850], slip: [800, 1300], rough: [800, 1200], norail: [400, 750], pit: [450, 600] };
  const startAt = 450, endAt = lap - 350;
  const needed = requests.reduce((sum, type) => sum + (LENGTHS[type][0] + LENGTHS[type][1]) / 2, 0);
  const gap = Math.max(60, (endAt - startAt - needed) / (requests.length + 1));
  const zones = [];
  let cursor = startAt;
  requests.forEach(type => {
    cursor += gap * (0.5 + rng());
    const length = LENGTHS[type][0] + rng() * (LENGTHS[type][1] - LENGTHS[type][0]);
    if (cursor + length > endAt) return;
    const s = Math.round(cursor), e = Math.round(cursor + length);
    const side = rng() < 0.5 ? -1 : 1;
    if (type === 'jump') zones.push(Z('jump', s, e, { height: Math.round(28 + rng() * 14) }));
    else if (type === 'rough') zones.push(Z('rough', s, e, { lane: side * 0.4, width: 0.24 }));
    else if (type === 'slip') zones.push(rng() < 0.6 ? Z('slip', s, e) : Z('slip', s, e, { lane: side * 0.25, width: 0.5 }));
    else if (type === 'norail') zones.push(Z('norail', s, e, { side: [-1, 1, 0][Math.floor(rng() * 3)] }));
    else if (type === 'pit') zones.push(Z('pit', s, e, { lane: side * 0.32, width: 0.3 }));
    else zones.push(Z(type, s, e));
    cursor = e;
  });
  zones.forEach(zone => {
    const style = ZONE_STYLE[zone.type];
    if (zone.label === undefined) zone.label = style.label;
    zone.color = style.color;
  });
  // 地雷: ジャンプ台とピットの周りには置かない
  const mines = [];
  for (let tries = 0; mines.length < p.mines && tries < p.mines * 20; tries++) {
    const s = 500 + rng() * (lap - 900);
    if (zones.some(zone => (zone.type === 'jump' || zone.type === 'pit') && s > zone.start - 80 && s < zone.end + 80)) continue;
    mines.push({ s: Math.round(s), lane: Math.round((rng() * 2 - 1) * 42) / 100 });
  }
  const base = COURSES.find(c => c.id === p.theme) || COURSES[0];
  const counts = [['ジャンプ', p.jump], ['氷', p.slip], ['レールなし', p.norail], ['地雷', mines.length]]
    .filter(([, n]) => n > 0).map(([label, n]) => `${label}${n}`);
  const built = {
    id: `custom-${hashText(JSON.stringify(p))}`, name: p.name || 'MY COURSE', accent: base.accent, lap,
    features: counts.length ? counts.join('・') : 'シンプル', custom: true, music: base.id,
    curve, elev, zones, mines, theme: base.theme, difficulty: 1
  };
  built.stars = courseStars(built, p);
  return built;
}
// 難しさの目安（カーブの外へ引っぱられる強さ ＋ ギミックの量）
function courseStars(c, p) {
  let maxPull = 0;
  for (let d = 0; d < c.lap; d += 20) {
    maxPull = Math.max(maxPull, Math.abs(waveOf(c.curve, c.lap, d + 120) - waveOf(c.curve, c.lap, d)) * 15 * 0.000012);
  }
  const pullRatio = maxPull / 0.0137;
  const gimmicks = p.jump * 0.35 + p.norail * 0.4 + p.mines * 0.04 + p.slip * 0.3 + p.rough * 0.2 - (p.pit ? 0.3 : 0);
  return clamp(Math.round(pullRatio * 4 + gimmicks * 0.7), 1, 5);
}

// プレビュー（コースの形と、ギミックの位置）
function drawEditorPreview() {
  const preview = /** @type {HTMLCanvasElement} */ (document.getElementById('editorMap'));
  const g = preview.getContext('2d');
  const w = preview.width, h = preview.height;
  g.clearRect(0, 0, w, h);
  const points = computeMapPoints(customCourse, w, h, 14);
  const pointAt = s => points[Math.min(MINIMAP_N, Math.round(((s % customCourse.lap) / customCourse.lap) * MINIMAP_N))];
  const strokeRange = (start, end, color, width) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    for (let s = start; s <= end; s += customCourse.lap / MINIMAP_N) {
      const [x, y] = pointAt(s);
      if (s === start) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  };
  g.lineJoin = 'round';
  g.shadowColor = customCourse.accent;
  g.shadowBlur = 8;
  strokeRange(0, customCourse.lap, '#e2e8f0', 3);
  g.shadowBlur = 0;
  customCourse.zones.forEach(zone => strokeRange(zone.start, zone.end, zone.color, 5));
  customCourse.mines.forEach(mine => {
    const [x, y] = pointAt(mine.s);
    g.fillStyle = '#ef4444';
    g.beginPath();
    g.arc(x, y, 2.2, 0, Math.PI * 2);
    g.fill();
  });
  const [sx, sy] = pointAt(0);
  g.fillStyle = '#fde047';
  g.fillRect(sx - 5, sy - 2, 10, 4);
  document.getElementById('editorStars').textContent =
    `難しさ ${'★'.repeat(customCourse.stars)}${'☆'.repeat(5 - customCourse.stars)}　${customCourse.features}`;
}
function shareLink() {
  const code = btoa(unescape(encodeURIComponent(JSON.stringify(editorParams))));
  return `${location.href.split('#')[0]}#course=${code}`;
}
function importCourseCode(text) {
  try {
    const code = String(text).trim().split('course=').pop();
    const parsed = JSON.parse(decodeURIComponent(escape(atob(code))));
    updateEditor(sanitizeEditorParams(parsed), true);
    renderEditor();
    showToast(`コース「${editorParams.name}」を読み込みました`, 'good', 2000);
    return true;
  } catch (error) {
    showToast('共有コードが読み取れませんでした', 'bad', 2200);
    return false;
  }
}
// 設定を変えたらコースを作り直す。commit=true のときは3D画面にも反映する
function updateEditor(change, commit) {
  editorParams = sanitizeEditorParams({ ...editorParams, ...change });
  writeStore('fzx-editor', editorParams);
  customCourse = generateCourse(editorParams);
  drawEditorPreview();
  /** @type {HTMLInputElement} */ (document.getElementById('shareCode')).value = shareLink();
  if (commit) {
    if (currentMode() === 'gp') selectedMode = 1;
    selectedCourse = courseList().length - 1;
    renderCourseCards();
    updateSetupUI();
  }
}
function renderEditor() {
  const container = document.getElementById('editorControls');
  container.innerHTML = '';
  EDITOR_DEFS.forEach(def => {
    container.appendChild(buildField(def, editorParams[def.key],
      value => updateEditor({ [def.key]: value }, false),
      value => updateEditor({ [def.key]: def.type === 'range' || def.type === 'number' ? Number(value) : value }, true)));
  });
  drawEditorPreview();
  /** @type {HTMLInputElement} */ (document.getElementById('shareCode')).value = shareLink();
}
document.getElementById('editorRandom').addEventListener('click', () => {
  const rng = Math.random;
  updateEditor({
    seed: Math.floor(rng() * 999999), curve: Math.round((0.4 + rng() * 1.0) * 20) / 20, complexity: 2 + Math.floor(rng() * 5),
    hills: Math.round(rng() * 18) / 10, dash: Math.floor(rng() * 4), jump: Math.floor(rng() * 3), slip: Math.floor(rng() * 3),
    rough: Math.floor(rng() * 3), norail: Math.floor(rng() * 5), mines: Math.floor(rng() * 16),
    theme: ['neon', 'canyon', 'storm', 'void'][Math.floor(rng() * 4)]
  }, true);
  renderEditor();
  playCue('ui');
});
document.getElementById('editorPlay').addEventListener('click', () => {
  updateEditor({}, true);
  if (currentMode() === 'gp') selectedMode = 1;
  setTab('race');
  startFromSetup();
});
document.getElementById('copyCode').addEventListener('click', () => {
  const input = /** @type {HTMLInputElement} */ (document.getElementById('shareCode'));
  const done = () => showToast('共有リンクをコピーしました', 'good', 1600);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(input.value).then(done).catch(() => { input.select(); document.execCommand('copy'); done(); });
  } else {
    input.select();
    document.execCommand('copy');
    done();
  }
});
document.getElementById('loadCode').addEventListener('click', () => {
  const input = /** @type {HTMLInputElement} */ (document.getElementById('importCode'));
  if (importCourseCode(input.value)) input.value = '';
});

// ---- 指でなぞる縦スクロール（設定パネル・リザルト） ----
// 縦持ちのスマホで画面を90°回して表示していると、ブラウザ標準のスクロールは
// 指の向きとゲーム画面の上下が合わず動かない。そのため指の動きを自分で読み取ってスクロールする
let dragScrollBlockUntil = 0;
function enableDragScroll(container) {
  let drag = null;
  container.addEventListener('pointerdown', event => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest('input, textarea')) return;   // スライダーや入力欄の操作は邪魔しない
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, top: container.scrollTop, moved: false };
  });
  addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    // 画面の回転に合わせて、ゲーム画面での「下向き」の移動量に直す
    const down = portraitView.rot === 90 ? -dx : (portraitView.rot === 270 ? dx : dy);
    if (!drag.moved && Math.abs(down) < 8) return;
    drag.moved = true;
    container.scrollTop = drag.top - down;
  });
  const end = event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.moved) dragScrollBlockUntil = performance.now() + 80;   // なぞった直後のタップ扱いを止める
    drag = null;
  };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  container.addEventListener('click', event => {
    if (performance.now() < dragScrollBlockUntil) {
      event.stopPropagation();
      event.preventDefault();
    }
  }, true);
}
enableDragScroll(document.querySelector('.setup-body'));
enableDragScroll(document.getElementById('resultOverlay'));
// 設定パネル内の要素が見えるようにスクロールする（回転表示でも正しく動くよう、レイアウト上の位置で計算）
function revealInSetup(el) {
  const container = /** @type {HTMLElement} */ (document.querySelector('.setup-body'));
  let top = 0;
  let node = el;
  while (node && node !== container) {
    top += node.offsetTop;
    node = /** @type {HTMLElement} */ (node.offsetParent);
  }
  if (node !== container) return;
  const bottom = top + el.offsetHeight;
  if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = Math.min(top - 8, bottom - container.clientHeight + 8);
  else if (top < container.scrollTop) container.scrollTop = top - 8;
}

// ---- タブ切り替え ----
function setTab(tab) {
  activeTab = tab;
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#setupTabs button')).forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.tab-panel')).forEach(panel => { panel.hidden = panel.dataset.panel !== tab; });
  if (tab === 'garage') renderGarage();
  if (tab === 'editor') {
    renderEditor();
    updateEditor({}, true);   // 作ったコースを背景にプレビュー
  }
  if (tab === 'options') renderOptions();
}
/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#setupTabs button')).forEach(button => button.addEventListener('click', () => {
  setTab(button.dataset.tab);
  playCue('ui');
}));

// 起動時: 自作コースを用意し、共有リンク（#course=...）で開かれたらそのコースを読み込む
customCourse = generateCourse(editorParams);
if (location.hash.startsWith('#course=')) {
  setTimeout(() => {
    if (importCourseCode(location.hash)) setTab('editor');
  }, 300);
}
