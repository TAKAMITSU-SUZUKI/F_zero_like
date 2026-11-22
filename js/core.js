// @ts-check
// 基本設定・コース定義・入力（ボタン/キー/傾き以外）・ユーザー設定・ポイント保存・マシン定義・自機とライバルの状態
// ※ ファイルは index.html に書いた順に読み込まれ、変数や関数はファイル間で共有される
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('c'));
const ctx = canvas.getContext('2d');
// 2Dオーバーレイの論理座標: 高さは常に450、幅は画面の縦横比に合わせて変わる（横長のスマホでも歪まない）
let W = 800;
const H = 450;
const HORIZON = 165;
let TOTAL_LAPS = 3;
const TOTAL_RACERS = 16;
const VIEW_DISTANCE = 2500;
const PLAYER_LANE_SCALE = 0.58;
const RIVAL_LANE_SCALE = 0.72;

// ===== コース定義 =====
// curve / elev: [振幅, 周回あたりの波の数, 位相] の合成でコースの曲がりと起伏を作る
// zones: lane/width は横位置（自機は ±0.53 まで）。width>1 は全幅
// mines: 地雷の位置 s（1周内の距離）と横位置 lane
const Z = (type, start, end, extra) => ({ type, start, end, lane: 0, width: 1.9, ...extra });
const ZONE_STYLE = {
  dash: { label: 'DASH', color: '#22d3ee' },
  pit: { label: 'PIT', color: '#4ade80' },
  jump: { label: 'JUMP', color: '#facc15' },
  slip: { label: 'ICE', color: '#7dd3fc' },
  rough: { label: 'ROUGH', color: '#fb923c' },
  norail: { label: 'NO RAIL', color: '#f97316' }   // ガードレールなし（side: -1=左 1=右 0=両側）。外へ出ると落下
};
const COURSES = [
  {
    id: 'neon', name: 'NEON CIRCUIT', accent: '#22d3ee', lap: 7200,
    features: 'ダッシュ・ジャンプ・ピット',
    curve: [[145, 1, 0.35], [58, 2, -0.9], [22, 4, 0.5]],
    elev: [[28, 3, 0.4], [9, 7, -1.1]],
    zones: [
      Z('dash', 1650, 2250),
      Z('jump', 3100, 3850, { height: 30 }),
      Z('pit', 4550, 5150, { lane: -0.32, width: 0.32 }),
      Z('dash', 6200, 6600),
      Z('norail', 6700, 7050, { side: 1 })
    ],
    mines: [{ s: 5650, lane: 0.3 }, { s: 5800, lane: -0.15 }, { s: 5950, lane: 0.1 }],
    theme: {
      sky: ['#02030c', '#0a0b26', '#2a1650', '#a33a7a', '#f6a585', '#3a1f58', '#2a1846'],
      fog: 0x2a1846, grid: [0x8b5cf6, 0x4c2f8a], ground: 0x140c28, asphalt: [0x3d4155, 0x33364a], wall: 0x26324f,
      buildings: ['#2a1b4d', '#321f57', '#22163f'], windows: ['rgba(103,232,249,0.75)', 'rgba(244,114,182,0.7)'],
      sun: 0xffc9a0, lightning: false
    }
  },
  {
    id: 'canyon', name: 'SUNSET CANYON', accent: '#fb923c', lap: 8400,
    features: '大ジャンプ×2・荒れ地・地雷',
    curve: [[120, 1, 0.2], [70, 2, 1.4], [35, 3, -0.6], [18, 5, 2.0]],
    elev: [[40, 2, 0.3], [14, 5, 1.0]],
    zones: [
      Z('dash', 900, 1300),
      Z('rough', 2000, 3400, { lane: -0.43, width: 0.22 }),
      Z('rough', 2000, 3400, { lane: 0.43, width: 0.22, label: '' }),
      Z('jump', 3800, 4700, { height: 40 }),
      Z('pit', 5300, 5900, { lane: 0.32, width: 0.32 }),
      Z('jump', 6600, 7300, { height: 28 }),
      Z('dash', 7600, 8000),
      Z('norail', 4700, 5250, { side: 0 }),
      Z('norail', 7300, 7600, { side: -1 })
    ],
    mines: [{ s: 4950, lane: -0.3 }, { s: 5050, lane: 0 }, { s: 5150, lane: 0.3 }, { s: 6200, lane: -0.1 }, { s: 6300, lane: 0.2 }],
    theme: {
      sky: ['#120604', '#2a0f08', '#5a1e0e', '#d9622b', '#ffd08a', '#6b2f17', '#4a2414'],
      fog: 0x4a2414, grid: [0xf97316, 0x7c2d12], ground: 0x24100a, asphalt: [0x4a403d, 0x403634], wall: 0x4a2a1c,
      buildings: ['#3b1a10', '#4a2214', '#2e140c'], windows: ['rgba(251,191,36,0.55)', 'rgba(248,113,113,0.45)'],
      sun: 0xffb870, lightning: false
    }
  },
  {
    id: 'storm', name: 'STORM HIGHWAY', accent: '#7dd3fc', lap: 7800,
    features: '凍結路面・地雷原・雷雨',
    curve: [[100, 1, -0.4], [40, 3, 0.9], [30, 4, 2.2], [12, 6, 0]],
    elev: [[22, 4, 0], [10, 9, 1.2]],
    zones: [
      Z('slip', 1200, 2600),
      Z('dash', 2900, 3300),
      Z('pit', 4800, 5400, { lane: -0.32, width: 0.32 }),
      Z('jump', 5800, 6600, { height: 34 }),
      Z('slip', 6800, 7500, { lane: 0.25, width: 0.5 }),
      Z('norail', 1800, 2400, { side: 1 }),
      Z('norail', 6600, 6950, { side: -1 })
    ],
    mines: [
      { s: 3650, lane: -0.35 }, { s: 3700, lane: 0.05 }, { s: 3800, lane: 0.38 }, { s: 3900, lane: -0.12 },
      { s: 4000, lane: 0.22 }, { s: 4100, lane: -0.4 }, { s: 4200, lane: 0 }, { s: 4300, lane: 0.35 }
    ],
    theme: {
      sky: ['#010409', '#061220', '#0c2a3d', '#1f6f8b', '#9be7ff', '#123446', '#0b2233'],
      fog: 0x0b2233, grid: [0x22d3ee, 0x155e75], ground: 0x06121c, asphalt: [0x354150, 0x2d3845], wall: 0x1d3a4f,
      buildings: ['#0c2233', '#102a3d', '#081a28'], windows: ['rgba(125,211,252,0.7)', 'rgba(167,243,208,0.6)'],
      sun: 0x9be7ff, lightning: true
    }
  },
  {
    // 高難度: 急カーブの連続・ガードレールのない区間だらけ・着地点が崖の大ジャンプ・氷上の崖・強いライバル
    id: 'void', name: 'VOID SPIRAL', accent: '#ef4444', lap: 8000, difficulty: 1.07,
    features: '★高難度 レールなし急カーブ・崖ジャンプ',
    // 曲がりの強さは通常速度で旋回限界の約7割。カーブでブーストすると曲がりきれない
    curve: [[140, 1, 0.8], [84, 3, -0.4], [48, 5, 1.7], [17, 8, 0.3]],
    elev: [[45, 2, 0], [20, 5, 1.3], [8, 9, 0.5]],
    zones: [
      Z('dash', 250, 550),
      Z('norail', 800, 1500, { side: 0 }),
      Z('jump', 2200, 3000, { height: 44 }),
      Z('norail', 2900, 3450, { side: 0 }),
      Z('slip', 3600, 4500),
      Z('norail', 3800, 4400, { side: 1 }),
      Z('rough', 4600, 5600, { lane: -0.4, width: 0.26 }),
      Z('norail', 5000, 5500, { side: -1 }),
      Z('pit', 5800, 6150, { lane: 0.36, width: 0.26 }),
      Z('dash', 6350, 6600),
      Z('jump', 6700, 7350, { height: 36 }),
      Z('norail', 7300, 7800, { side: -1 })
    ],
    mines: [
      { s: 1650, lane: -0.3 }, { s: 1720, lane: 0.25 }, { s: 1800, lane: 0 }, { s: 1880, lane: -0.15 },
      { s: 1960, lane: 0.38 }, { s: 2040, lane: -0.42 }, { s: 5300, lane: 0.1 }, { s: 5400, lane: 0.35 },
      { s: 7850, lane: -0.2 }, { s: 7920, lane: 0.2 }
    ],
    theme: {
      sky: ['#000000', '#05010a', '#1a0420', '#6b0f2a', '#ff5a3c', '#2a0612', '#14030a'],
      fog: 0x14030a, grid: [0xef4444, 0x7f1d1d], ground: 0x0a0206, asphalt: [0x2e2a36, 0x26222e], wall: 0x3a1426,
      buildings: ['#1a0610', '#220814', '#12040a'], windows: ['rgba(248,113,113,0.6)', 'rgba(251,191,36,0.5)'],
      sun: 0xff6a4a, lightning: true
    }
  }
];
COURSES.forEach(courseDef => courseDef.zones.forEach(zone => {
  const style = ZONE_STYLE[zone.type];
  if (zone.label === undefined) zone.label = style.label;
  if (!zone.color) zone.color = style.color;
}));
let course = COURSES[0];
let LAP_DISTANCE = course.lap;
let TOTAL_DISTANCE = LAP_DISTANCE * TOTAL_LAPS;
let TRACK_ZONES = course.zones;

function resizeCanvas() {
  // 画面を90°回して表示しているときも正しい大きさになるよう、回転前の大きさを使う
  const rect = { width: canvas.clientWidth, height: canvas.clientHeight };
  const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2.5);
  canvas.width = Math.round(rect.width * pixelRatio);
  canvas.height = Math.round(rect.height * pixelRatio);
  W = Math.round(H * (rect.width || 16) / (rect.height || 9));
  ctx.imageSmoothingEnabled = true;
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
}
addEventListener('resize', resizeCanvas);
// 画面サイズの変化を毎フレーム確認する。アプリ内ブラウザは回転やアドレスバーの出入りで
// resize を通知しないことがあり、そのままだと古い縦横比で描かれて横に引き伸ばされる
const viewportSize = { w: 0, h: 0 };
// ---- 縦向きの画面で横持ちしたときは、ゲーム画面を90°回す ----
// 回す向きは「向きのセンサー」で、スマホを左右どちらに倒して持っているかから決める
const portraitView = { rot: 0, pref: 90 };
function updatePortraitRotation() {
  const portrait = IS_TOUCH && window.innerHeight > window.innerWidth;
  const rot = portrait ? portraitView.pref : 0;
  if (rot === portraitView.rot) return;
  portraitView.rot = rot;
  const wrap = document.getElementById('wrap');
  wrap.classList.toggle('rot90', rot === 90);
  wrap.classList.toggle('rot270', rot === 270);
}
addEventListener('deviceorientation', event => {
  if (event.beta === null || event.gamma === null || event.beta === undefined) return;
  // 端末から見た「上」の向き。x>0 は画面の右側が上（左に倒して持っている）
  const upX = -Math.cos(event.beta * Math.PI / 180) * Math.sin(event.gamma * Math.PI / 180);
  if (Math.abs(upX) > 0.7) portraitView.pref = upX > 0 ? 90 : 270;
});
function flipPortraitRotation() {
  portraitView.pref = portraitView.pref === 90 ? 270 : 90;
  portraitView.rot = 0;
  updatePortraitRotation();
}
function watchViewportSize() {
  updatePortraitRotation();
  const w = Math.round(canvas.clientWidth), h = Math.round(canvas.clientHeight);
  if (w === viewportSize.w && h === viewportSize.h) return;
  viewportSize.w = w;
  viewportSize.h = h;
  if (!w || !h) return;
  resizeCanvas();
  if (window.resize3D) window.resize3D();
}
addEventListener('orientationchange', () => setTimeout(watchViewportSize, 300));
resizeCanvas();

const keys = { left: false, right: false, gas: false, boost: false, drift: false };

// ===== ユーザー設定（ブラウザに保存） =====
// Brave ブラウザ（シールド機能が傾きセンサーや対戦の通信を止めることがあるので、案内を出し分ける）
const IS_BRAVE = Boolean(/** @type {any} */ (navigator).brave);
const BRAVE_SHIELD_HINT = 'Braveをお使いの場合は、アドレスバーのライオン🦁を押してこのサイトの「シールド」をオフにし、ページを読み込み直してください';
const IS_TOUCH = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch (error) {
    return { ...fallback };
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // 保存できない環境では、その回の設定だけ使う
  }
}
// オプション: 周回数・ライバル数・難易度・操作方法・画質など
const raceOptions = readStore('fzx-options', {
  laps: 3, rivals: 15, difficulty: 1, control: 'buttons', autoAccel: IS_TOUCH,
  steer: 1, tiltRange: 14, touchLift: 0, quality: IS_TOUCH ? 'low' : 'high'
});
// 以前の初期値（22°）は傾け量が大きすぎて曲がらないと感じやすいので、新しい初期値に置き換える
if (raceOptions.tiltRange === 22) raceOptions.tiltRange = 14;
// ガレージ: マシンごとの色・エンジンの光・チューニング
const garage = readStore('fzx-garage', {});
// ===== ポイントとパーツ（ブラウザに保存） =====
// レースでポイントを獲得 → ガレージでパーツを買ってマシンに装着する。
// ・どのパーツにも長所と短所がある（速くなるが壊れやすい、安定するが最高速が落ちる など）
// ・マシンごとに「積載量」の上限があり、強いパーツほど負荷が大きいので全部は付けられない
//   → ポイントを貯めても無制限には速くならず、組み合わせの工夫が必要になる
const PART_SLOTS = [
  { key: 'engine', name: '⚙ エンジン' },
  { key: 'booster', name: '🔥 ブースター' },
  { key: 'wing', name: '🪽 ウイング' },
  { key: 'stabilizer', name: '⚓ スタビライザー' },
  { key: 'armor', name: '🛡 装甲' }
];
// mods: 性能の倍率（overload・doriWindow だけは足し算）
//  top 最高速 / accel 加速 / boostTop ブースト速度 / boostDrain ブースト消費 / boostRegen ブースト回復
//  steer 旋回 / dori ドリドリの伸び / doriWindow 切り返しの猶予 / damage 被ダメージ / impact 接触の衝撃
//  pitRate PIT回復 / overload エネルギー0から耐えられる量 / airGrip 空中の操作 / iceGrip 氷上のグリップ
//  pull カーブで外へ流される量 / wallGuard 壁での減速 / roughResist 荒れ地での減速
const PARTS = [
  { id: 'e_turbo', slot: 'engine', name: 'ターボ', price: 250, load: 2,
    desc: '低速からの立ち上がりが鋭くなる。接触や地雷からの復帰が速い。', mods: { accel: 1.18, top: 1.01 } },
  { id: 'e_high', slot: 'engine', name: 'ハイパワー', price: 400, load: 3,
    desc: '最高速と加速がバランスよく上がるが、熱を持つぶん壊れやすい。', mods: { top: 1.05, accel: 1.05, damage: 1.12 } },
  { id: 'e_v12', slot: 'engine', name: 'レース用V12', price: 650, load: 5,
    desc: '最高速は最強。ただし重くて加速が鈍り、ブーストの消費も増える。', mods: { top: 1.09, accel: 0.9, boostDrain: 1.15 } },
  { id: 'b_big', slot: 'booster', name: '大型ブースター', price: 300, load: 3,
    desc: 'ブースト中の速度が上がるが、ブーストを早く使い切る。', mods: { boostTop: 1.06, boostDrain: 1.3 } },
  { id: 'b_eco', slot: 'booster', name: '省エネノズル', price: 250, load: 1,
    desc: 'ブーストが長持ちする。速度はわずかに落ちる。', mods: { boostDrain: 0.72, boostTop: 0.98 } },
  { id: 'b_charge', slot: 'booster', name: '急速チャージャー', price: 350, load: 2,
    desc: 'ブーストゲージの回復が速い。こまめに使う人向け。', mods: { boostRegen: 1.5 } },
  { id: 'w_down', slot: 'wing', name: 'ダウンフォース', price: 250, load: 2,
    desc: '大きなリアウイング。カーブで外へ流されにくく氷にも強いが、空気抵抗で最高速が少し落ちる。', mods: { pull: 0.72, iceGrip: 1.3, steer: 1.05, top: 0.98 } },
  { id: 'w_glide', slot: 'wing', name: 'グライダー', price: 300, load: 2,
    desc: '左右に広い翼。ジャンプ中でもよく曲がれ、崖ジャンプの着地を狙いやすい。', mods: { airGrip: 2.5, top: 0.99 } },
  { id: 'w_aero', slot: 'wing', name: 'エアロフィン', price: 350, load: 1,
    desc: '空気抵抗を減らして最高速アップ。そのぶん曲がりにくく、カーブで流されやすい。', mods: { top: 1.03, steer: 0.94, pull: 1.12 } },
  { id: 's_side', slot: 'stabilizer', name: 'サイドスタビ', price: 250, load: 2,
    desc: '横の安定板。体当たりされても弾かれにくく、壁に擦っても減速しにくい。ドリドリは少し伸びにくい。', mods: { impact: 0.75, wallGuard: 0.6, dori: 0.9 } },
  { id: 's_gyro', slot: 'stabilizer', name: 'ジャイロ', price: 350, load: 2,
    desc: '姿勢を自動で保つ装置。氷・荒れ地・カーブに強くなるが、ハンドルの反応が少し鈍る。', mods: { iceGrip: 1.5, roughResist: 0.5, pull: 0.85, steer: 0.96 } },
  { id: 's_drift', slot: 'stabilizer', name: 'ドリフトフィン', price: 300, load: 2,
    desc: 'ドリドリ専用。伸びが大きく切り返しの猶予も長いが、車体が不安定になる。', mods: { dori: 1.2, doriWindow: 4, pull: 1.1 } },
  { id: 'a_light', slot: 'armor', name: '軽量フレーム', price: 200, load: -2,
    desc: '装甲を削って軽くする。加速が上がり積載にも余裕ができるが、ダメージに弱い。', mods: { accel: 1.1, damage: 1.3 } },
  { id: 'a_heavy', slot: 'armor', name: '重装甲', price: 350, load: 3,
    desc: '分厚い装甲。ダメージと接触に強いが、重くて加速が落ちる。', mods: { damage: 0.75, impact: 0.8, accel: 0.92 } },
  { id: 'a_shield', slot: 'armor', name: 'シールド', price: 450, load: 3,
    desc: 'エネルギーの防御膜。PITでの回復が速く、エネルギー0でも粘れる。', mods: { pitRate: 1.35, overload: 3, damage: 0.9 } }
];
const MACHINE_CAPACITY = { comet: 9, bike: 7, titan: 11, needle: 8 };   // 積載量（マシンごと）
const PART_MOD_DEFAULTS = {
  top: 1, accel: 1, boostTop: 1, boostDrain: 1, boostRegen: 1, steer: 1, dori: 1, damage: 1, impact: 1,
  pitRate: 1, airGrip: 1, iceGrip: 1, pull: 1, wallGuard: 1, roughResist: 1, overload: 0, doriWindow: 0
};
const ADDITIVE_MODS = ['overload', 'doriWindow'];
const partById = id => PARTS.find(part => part.id === id) || null;
const progress = readStore('fzx-progress', { points: 0, owned: [], loadouts: {} });
progress.points = Math.max(0, Math.floor(Number(progress.points) || 0));
if (!Array.isArray(progress.owned)) progress.owned = [];
progress.owned = progress.owned.filter(id => partById(id));
if (!progress.loadouts || typeof progress.loadouts !== 'object') progress.loadouts = {};
// 以前の段階強化（Lv制）は廃止。使ったポイントは全額返す
if (progress.upgrades && typeof progress.upgrades === 'object') {
  const OLD_COSTS = [120, 200, 320, 480, 700];
  Object.values(progress.upgrades).forEach(level => {
    const lv = Math.max(0, Math.min(5, Math.floor(Number(level) || 0)));
    progress.points += OLD_COSTS.slice(0, lv).reduce((sum, cost) => sum + cost, 0);
  });
  delete progress.upgrades;
  saveProgress();
}
// マシンに付けているパーツ（持っていない・場所違いのパーツは外して読む）
function machineLoadout(machineId) {
  const saved = progress.loadouts[machineId] || {};
  const loadout = {};
  PART_SLOTS.forEach(slot => {
    const part = partById(saved[slot.key]);
    if (part && part.slot === slot.key && progress.owned.includes(part.id)) loadout[slot.key] = part.id;
  });
  return loadout;
}
function loadoutLoad(loadout) {
  return Object.values(loadout).reduce((sum, id) => sum + (partById(id) ? partById(id).load : 0), 0);
}
function partMods(loadout) {
  const mods = { ...PART_MOD_DEFAULTS };
  Object.values(loadout).forEach(id => {
    const part = partById(id);
    if (!part) return;
    Object.entries(part.mods).forEach(([key, value]) => {
      if (ADDITIVE_MODS.includes(key)) mods[key] += value;
      else mods[key] *= value;
    });
  });
  return mods;
}
function saveProgress() {
  writeStore('fzx-progress', progress);
}
let paused = false;
let pausedAt = 0;
let hintSeen = false;   // 操作説明を一度見たか
let activeTab = 'race';
// 傾き操作（スマホを左右に傾けて曲がる）
const tilt = { supported: false, active: false, raw: 0, value: 0, offset: 0, lastEvent: 0, needsCalibration: true };

// ===== マシン定義 =====
// stats: 表示用の5段階評価 / 残りは走行性能の倍率
const MACHINES = [
  {
    id: 'comet', name: 'BLUE COMET', type: 'バランス型', color: '#0284c7',
    desc: 'クセのない万能マシン。どのコースでも安定して走れる。',
    stats: { speed: 3, accel: 3, grip: 3, boost: 3, body: 3 },
    top: 1.0, accel: 1.0, steer: 1.0, boostTop: 1.0, boostDrain: 1.0, damage: 1.0, impact: 1.0, dori: 1.0
  },
  {
    id: 'bike', name: 'RAZOR BIKE', type: 'バイク型', color: '#a855f7',
    desc: '細身で軽量。加速と旋回が鋭く、ドリドリの伸びも大きい。ただし装甲は薄い。',
    stats: { speed: 2, accel: 5, grip: 5, boost: 2, body: 1 },
    top: 0.95, accel: 1.4, steer: 1.3, boostTop: 0.96, boostDrain: 1.0, damage: 1.5, impact: 1.25, dori: 1.3
  },
  {
    id: 'titan', name: 'IRON TITAN', type: '重量級', color: '#f59e0b',
    desc: '分厚い装甲と4発エンジン。最高速と耐久は随一だが、加速と旋回は重い。',
    stats: { speed: 4, accel: 1, grip: 2, boost: 3, body: 5 },
    top: 1.08, accel: 0.68, steer: 0.75, boostTop: 1.02, boostDrain: 1.1, damage: 0.55, impact: 0.55, dori: 0.7
  },
  {
    id: 'needle', name: 'NEEDLE ARROW', type: 'ブースト特化', color: '#10b981',
    desc: '長いノーズの高速ダート。ブースト時の最高速と燃費が抜群。曲がりは少し苦手。',
    stats: { speed: 3, accel: 3, grip: 2, boost: 5, body: 2 },
    top: 1.0, accel: 0.95, steer: 0.88, boostTop: 1.13, boostDrain: 0.72, damage: 1.2, impact: 1.1, dori: 1.0
  }
];
const STAT_LABELS = { speed: 'SPEED', accel: 'ACCEL', grip: 'GRIP', boost: 'BOOST', body: 'BODY' };
const MODES = [
  { id: 'gp', name: 'GRAND PRIX', desc: '全4コースを連戦し、順位ポイントの合計で総合優勝を目指す（最終戦は高難度コース）。' },
  { id: 'single', name: 'SINGLE RACE', desc: '好きなコースを選んで1レース。' },
  { id: 'ta', name: 'TIME ATTACK', desc: 'ライバルなしの一人旅。自己ベストのゴーストと勝負。' },
  { id: 'online', name: 'ONLINE 対戦', desc: '友だちと2〜4人で対戦。部屋を作って招待リンクを送るか、部屋コードで入る。' }
];
let selectedMachine = 0;
let selectedMode = 0;
let selectedCourse = 0;
let focusRow = 0;              // セットアップ画面で操作中の行 0:モード 1:コース 2:マシン
let selectingMachine = true;   // セットアップ画面を表示中
let raceMode = 'gp';           // 実際に走っているモード
const currentMachine = () => MACHINES[selectedMachine];
const currentMode = () => MODES[selectedMode].id;
// ドリドリ: ドリフト保持中に左右を一定リズムで切り返すと最高速を超えて加速する
const DORI_MIN_INTERVAL = 4;    // これより速い切り返しは無効（連打しすぎ）
const DORI_MAX_INTERVAL = 26;   // これより遅いとコンボが切れる
const DORI_GAIN = 0.55;         // 1回の切り返しで上がる速度上限
const DORI_MAX_BONUS = 4.5;     // 上限ボーナス（通常330km/h → 約430km/h）
const boostFill = document.getElementById('boostFill');
const energyFill = document.getElementById('energyFill');
const audioState = { context: null, master: null, engineOsc: null, engineFilter: null, engineGain: null, failed: false };

// カウントダウン中にアクセルを押した時刻（ロケットスタート判定用）
// ロケットスタートの判定: 通常はアクセル、オートアクセル中はブーストを押したタイミングで判定する
function onGasDown() {
  if (countdown.active && !keys.gas && !raceOptions.autoAccel) countdown.gasPressedAt = performance.now();
}
function onGasUp() {
  if (countdown.active && !raceOptions.autoAccel) countdown.gasPressedAt = null;
}
function onBoostDown() {
  if (countdown.active && !keys.boost && raceOptions.autoAccel) countdown.gasPressedAt = performance.now();
}
function onBoostUp() {
  if (countdown.active && raceOptions.autoAccel) countdown.gasPressedAt = null;
}

function bindBtn(id, k) {
  const el = document.getElementById(id);
  el.addEventListener('pointerdown', event => {
    event.preventDefault();
    startAudio();
    if (k === 'gas') onGasDown();
    if (k === 'boost') onBoostDown();
    keys[k] = true;
    el.classList.add('on');
    try {
      el.setPointerCapture(event.pointerId);
    } catch (error) {
      // 捕捉できない環境でも、押している間の入力は続ける
    }
  });
  const release = event => {
    event.preventDefault();
    keys[k] = false;
    if (k === 'gas') onGasUp();
    if (k === 'boost') onBoostUp();
    el.classList.remove('on');
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);
}
// ハンドルは ◀▶ をまとめた1枚のパッドとして扱う。指を離さず左右に滑らせると切り替わる（ドリドリしやすい）
const steerPad = /** @type {HTMLElement} */ (document.querySelector('.steer-group'));
const steerButtons = { left: document.getElementById('bLeft'), right: document.getElementById('bRight') };
let steerPointer = null;
// 指に近いほうのボタンを押したことにする（画面を90°回して表示しているときも正しく判定できる）
function steerFromX(clientX, clientY) {
  const center = el => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  const [lx, ly] = center(steerButtons.left), [rx, ry] = center(steerButtons.right);
  const right = Math.hypot(clientX - rx, clientY - ry) < Math.hypot(clientX - lx, clientY - ly);
  keys.left = !right;
  keys.right = right;
  steerButtons.left.classList.toggle('on', !right);
  steerButtons.right.classList.toggle('on', right);
}
function releaseSteer(event) {
  if (event && event.pointerId !== steerPointer) return;
  steerPointer = null;
  keys.left = keys.right = false;
  steerButtons.left.classList.remove('on');
  steerButtons.right.classList.remove('on');
}
steerPad.addEventListener('pointerdown', event => {
  event.preventDefault();
  startAudio();
  steerPointer = event.pointerId;
  steerFromX(event.clientX, event.clientY);
  try {
    steerPad.setPointerCapture(event.pointerId);
  } catch (error) {
    // 捕捉できない環境でも、押している間の入力は続ける
  }
});
steerPad.addEventListener('pointermove', event => {
  if (event.pointerId === steerPointer) steerFromX(event.clientX, event.clientY);
});
steerPad.addEventListener('pointerup', releaseSteer);
steerPad.addEventListener('pointercancel', releaseSteer);
steerPad.addEventListener('lostpointercapture', releaseSteer);
bindBtn('bGas', 'gas'); bindBtn('bBoost', 'boost');
// 長押しメニュー（画像の保存など）を出さない
document.getElementById('wrap').addEventListener('contextmenu', event => event.preventDefault());

// ===== 画面の拡大を防ぐ（iPhoneは拡大禁止の指定を無視するため、ここで止める） =====
// ・操作ボタンへのタッチは拡大・スクロールの動作をすべて止める（ボタンの反応は pointer イベントで受けるので影響なし）
const touchLayer = document.getElementById('touch');
['touchstart', 'touchmove', 'touchend'].forEach(type => touchLayer.addEventListener(type, event => {
  if (event.cancelable) event.preventDefault();
}, { passive: false }));
// ・2本指で広げる拡大（ピンチ）を止める
['gesturestart', 'gesturechange', 'gestureend'].forEach(type => document.addEventListener(type, event => event.preventDefault()));
document.addEventListener('touchmove', event => {
  if (event.touches.length > 1 && event.cancelable) event.preventDefault();
}, { passive: false });
// ・素早い2回タップでの拡大を止める（入力欄は除く）
let lastTouchEnd = 0;
document.addEventListener('touchend', event => {
  const now = Date.now();
  const target = /** @type {HTMLElement} */ (event.target);
  const tag = target && target.tagName;
  // メニューのボタンを素早く続けて押した操作は消さない
  const isButton = target && target.closest && target.closest('button');
  if (now - lastTouchEnd < 350 && !isButton && tag !== 'INPUT' && tag !== 'TEXTAREA' && event.cancelable) event.preventDefault();
  lastTouchEnd = now;
}, { passive: false });
document.addEventListener('dblclick', event => event.preventDefault(), { passive: false });
// ・それでも拡大されてしまったら、等倍に戻す
const viewportMeta = /** @type {HTMLMetaElement} */ (document.getElementById('viewportMeta'));
function resetZoom() {
  if (!window.visualViewport || window.visualViewport.scale <= 1.01) return;
  const content = viewportMeta.content;
  viewportMeta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover';
  setTimeout(() => { viewportMeta.content = content; }, 50);
}
if (window.visualViewport) window.visualViewport.addEventListener('resize', resetZoom);
bindBtn('bDrift', 'drift');

function releaseAllInputs() {
  Object.keys(keys).forEach(key => { keys[key] = false; });
  document.querySelectorAll('.btn.on').forEach(button => button.classList.remove('on'));
}

addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  // 入力欄（コース名・共有コードなど）に文字を打っている間はゲーム操作にしない
  const tag = event.target && /** @type {HTMLElement} */ (event.target).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (!event.repeat && key === 'm') toggleAudio('bgm');
  if (!event.repeat && key === 'n') toggleAudio('se');
  if (!selectingMachine && !event.repeat && (key === 'escape' || key === 'p')) {
    setPaused(!paused);
    return;
  }
  if (paused) return;
  if (selectingMachine) {
    startAudio();
    if ((key === 'escape' || key === 'backspace') && !event.repeat) {
      event.preventDefault();
      prevStep();
      return;
    }
    if (activeTab !== 'race') return;
    if (['arrowleft', 'a', 'arrowright', 'd', 'arrowup', 'w', 'arrowdown', 's', 'enter', 'z', ' '].includes(key)) event.preventDefault();
    if (key === 'arrowleft' || key === 'a' || key === 'arrowup' || key === 'w') changeSetup(-1);
    if (key === 'arrowright' || key === 'd' || key === 'arrowdown' || key === 's') changeSetup(1);
    if ((key === 'enter' || key === 'z' || key === ' ') && !event.repeat) nextStep();
    return;
  }
  if (!raceHud.overlay.hidden) {
    if ((key === 'enter' || key === 'z') && !event.repeat) {
      event.preventDefault();
      const primary = /** @type {HTMLButtonElement | null} */ (raceHud.card.querySelector('button.primary'));
      if (primary) primary.click();
    }
    return;
  }
  if (['arrowleft', 'arrowright', 'a', 'd', 'z', ' ', 'shift', 'x'].includes(key)) {
    event.preventDefault();
    startAudio();
  }
  if (key === 'arrowleft' || key === 'a') keys.left = true;
  if (key === 'arrowright' || key === 'd') keys.right = true;
  if (key === 'z') {
    if (!event.repeat) onGasDown();
    keys.gas = true;
  }
  if (key === ' ') {
    if (!event.repeat) onBoostDown();
    keys.boost = true;
  }
  if (key === 'shift' || key === 'x') keys.drift = true;
});
addEventListener('keyup', event => {
  const key = event.key.toLowerCase();
  if (key === 'arrowleft' || key === 'a') keys.left = false;
  if (key === 'arrowright' || key === 'd') keys.right = false;
  if (key === 'z') {
    keys.gas = false;
    onGasUp();
  }
  if (key === ' ') {
    keys.boost = false;
    onBoostUp();
  }
  if (key === 'shift' || key === 'x') keys.drift = false;
});
addEventListener('blur', releaseAllInputs);

const CAR_DEFAULTS = {
  x: 0, tilt: 0, slide: 0, speed: 0, dist: 0, boost: 100, energy: 100,
  shake: 0, collisionCooldown: 0, dashTimer: 0, status: 'racing', wasBoosting: false,
  driftBonus: 0, lastSteerDir: 0, sinceSwitch: 99, driftCombo: 0, steerAxis: 0,
  air: false, stallTimer: 0, onSlip: false, onRough: false, scraping: false, drifting: false,
  fallTimer: 0, fallDepth: 0, fallVel: 0, fallSpin: 0, fallDir: 0, fallDist: 0, respawnTimer: 0,
  overload: 0, damageFlash: 0, alarmTimer: 0, pitTimer: 0, retireReason: '',
  maxCombo: 0, attackCount: 0, doriFlash: 0
};
const FALL_FRAMES = 80;      // 落下演出の長さ（フレーム）
const RESPAWN_FRAMES = 170;  // 復帰後に半透明（無敵）でいる長さ
const car = { ...CAR_DEFAULTS, sparks: [] };

// ===== ライバル =====
const RIVAL_NAMES = ['VEGA', 'ORION', 'NOVA', 'LYNX', 'RAVEN', 'ZERO', 'BLAZE', 'KAISER',
  'ASTRA', 'VOLT', 'SABER', 'ECHO', 'FALCON', 'JINX', 'COBALT'];
// runner: 序盤が速い / closer: 終盤に伸びる / blocker: 後ろの自機の進路をふさぐ / steady: 安定型
const RIVAL_STYLES = ['runner', 'closer', 'blocker', 'steady'];
const RIVAL_COLORS = ['#e64b58', '#f0a52b', '#38a8c8', '#7659c5', '#4caa75'];
// スターティンググリッド: 3台×5列。自機は最後尾からスタート（前の列ほど速いライバル）
function gridRacer(i) {
  const row = Math.floor(i / 3);
  const lane = [-0.55, 0, 0.55][i % 3];
  return {
    name: RIVAL_NAMES[i],
    dist: 42 + (4 - row) * 46,
    lane,
    targetLane: lane,
    speed: 0,
    laneChangeTimer: 80 + (i * 37) % 120,
    skill: 1.1 - row * 0.035 - ((i * 7) % 5) * 0.008,
    style: RIVAL_STYLES[i % RIVAL_STYLES.length],
    boost: 40 + (i * 13) % 50,
    boostTimer: 0,
    energy: 100,
    status: raceMode === 'ta' || i >= (raceMode === 'online' ? online.rivals : raceOptions.rivals) ? 'absent' : 'racing',
    finishAt: null,
    color: RIVAL_COLORS[i % RIVAL_COLORS.length]
  };
}
const racers = Array.from({ length: TOTAL_RACERS - 1 }, (_, i) => gridRacer(i));
const raceHud = {
  lap: document.getElementById('lapText'),
  rank: document.getElementById('rankText'),
  time: document.getElementById('timeText'),
  rivals: document.getElementById('rivalText'),
  gap: document.getElementById('gapText'),
  overlay: document.getElementById('resultOverlay'),
  card: document.getElementById('resultCard')
};
let raceStartedAt = performance.now();
let lapStartedAt = raceStartedAt;
let raceStarted = false;
let completedLaps = 0;
let finishTime = null;     // ゴールタイム(ms)
let finishAt = null;       // ゴール/リタイアした時刻
let finalRank = null;
let resultsAt = null;      // リザルト画面を出す時刻
let koCount = 0;
let lastResult = { newBest: false, newLap: false };
const lapTimes = [];
const mineHits = new Set();   // `${周回}:${地雷番号}`
const zoneHits = new Set();   // `${周回}:${ゾーン番号}`
const effects = { explosions: [] };
const fireworks = [];
const countdown = { active: false, startAt: 0, step: -1, gasPressedAt: null };
const gp = { active: false, index: 0, points: {} };
const GP_POINTS = [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const GHOST_INTERVAL = 100;   // ゴーストの記録間隔(ms)
let ghostRecord = [];
let ghostData = null;
const ghostState = { visible: false, dist: 0, x: 0 };
