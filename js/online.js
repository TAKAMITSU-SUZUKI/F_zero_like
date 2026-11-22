// @ts-check
// オンライン対戦（2〜4人）。サーバーは使わず、スマホ同士を直接つなぐ（WebRTC / PeerJS）
// ※ ファイルは index.html に書いた順に読み込まれ、変数や関数はファイル間で共有される
//
// しくみ:
//  ・部屋を作った人（ホスト）に、他の人（ゲスト）がつながる星形の接続。ゲスト同士の通信はホストが中継する
//  ・各自のスマホが自分のマシンを動かし、位置を1秒に約12回送り合う。相手のマシンは届いた位置をなめらかに補って表示
//  ・CPUライバルはホストだけが動かし、その位置をゲストへ配る（ゲストがCPUに体当たりした結果もホストが判定）
//  ・相手を見つける最初の手続きだけ、PeerJS の無料公開サーバーを使う

const ONLINE_MAX = 4;
const ONLINE_PREFIX = 'neonracer-v1-';
const ONLINE_SEND_MS = 80;
const ONLINE_START_LANES = [-0.7, 0.7, -0.25, 0.25];   // 人間同士のスタート位置（横）
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // 見間違えやすい 0/O・1/I は使わない
const onlineProfile = readStore('fzx-online', { name: '' });
const online = {
  peer: null,
  /** @type {'host' | 'guest' | null} */
  role: null,
  code: '',
  myId: '',
  /** @type {Map<string, any>} ホスト: 参加者ごとの接続 */
  conns: new Map(),
  hostConn: null,
  /** @type {any[]} ロビーの参加者（先頭がホスト） */
  players: [],
  settings: null,
  /** @type {Map<string, any>} レース中の相手（自分以外） */
  remotes: new Map(),
  ready: false,
  inRace: false,
  rivals: 0,
  lastSend: 0,
  lastTick: 0
};

// ---- 参加情報 ----
function onlineName() {
  const name = String(onlineProfile.name || '').trim().slice(0, 10);
  return name || 'PLAYER';
}
function myMachineInfo() {
  const m = effectiveMachine();
  return { id: m.id, color: m.color, glow: m.glow, parts: m.parts };
}
function selfPlayer() {
  return { pid: online.myId, name: onlineName(), machine: myMachineInfo(), ready: online.role === 'host' || online.ready };
}
// 相手から届いた値は信用せず、形を整えてから使う
function cleanMachine(machine) {
  const m = machine && typeof machine === 'object' ? machine : {};
  const id = MACHINES.some(def => def.id === m.id) ? m.id : 'comet';
  const color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : MACHINES.find(def => def.id === id).color;
  const glow = /^#[0-9a-f]{6}$/i.test(m.glow) ? m.glow : GLOW_COLORS[0];
  const parts = {};
  if (m.parts && typeof m.parts === 'object') {
    PART_SLOTS.forEach(slot => {
      const part = partById(m.parts[slot.key]);
      if (part && part.slot === slot.key) parts[slot.key] = part.id;
    });
  }
  return { id, color, glow, parts };
}
function cleanPlayer(p) {
  return {
    pid: String(p && p.pid || '').slice(0, 64),
    name: String(p && p.name || 'PLAYER').slice(0, 10),
    machine: cleanMachine(p && p.machine),
    ready: Boolean(p && p.ready)
  };
}
const num = (value, fallback = 0) => (typeof value === 'number' && isFinite(value) ? value : fallback);

// ---- 通信ライブラリ（PeerJS）は、オンラインを使うときだけ読み込む ----
let peerJsPromise = null;
function loadPeerJS() {
  if (window.Peer) return Promise.resolve();
  if (!peerJsPromise) {
    peerJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
      script.onload = () => resolve(undefined);
      script.onerror = () => {
        peerJsPromise = null;
        reject(new Error('peerjs'));
      };
      document.head.appendChild(script);
    });
  }
  return peerJsPromise;
}
function makeRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  return code;
}

// ---- 送信 ----
function onlineSendToHost(msg) {
  if (online.hostConn && online.hostConn.open) online.hostConn.send(msg);
}
function onlineBroadcast(msg, exceptPid) {
  online.conns.forEach((conn, pid) => {
    if (pid !== exceptPid && conn.open) conn.send(msg);
  });
}
function onlineSendTo(pid, msg) {
  if (online.role === 'host') {
    const conn = online.conns.get(pid);
    if (conn && conn.open) conn.send(msg);
  } else {
    onlineSendToHost(msg);   // ゲスト宛てはホストが中継する
  }
}

// ---- 部屋を作る（ホスト） ----
async function onlineCreateRoom(attempt = 0) {
  onlineLeave(true);
  setOnlineStatus('部屋を作っています…');
  try {
    await loadPeerJS();
  } catch (error) {
    setOnlineStatus('通信の準備に失敗しました。電波の良い所で、もう一度試してください', true);
    return;
  }
  const code = makeRoomCode();
  const peer = new window.Peer(ONLINE_PREFIX + code, { debug: 0 });
  online.peer = peer;
  online.role = 'host';
  online.code = code;
  peer.on('open', id => {
    online.myId = id;
    online.players = [selfPlayer()];
    setOnlineStatus('友だちを招待してください（最大4人）');
    renderOnlinePanel();
    playCue('ok');
  });
  peer.on('connection', conn => onlineAcceptGuest(conn));
  peer.on('error', err => {
    if (online.peer !== peer) return;   // すでに閉じた部屋のエラーは無視
    if (err && err.type === 'unavailable-id' && attempt < 3) {
      onlineCreateRoom(attempt + 1);   // 同じコードが使われていたら作り直す
      return;
    }
    onlineError(err);
  });
  peer.on('disconnected', () => {
    try {
      if (online.peer === peer) peer.reconnect();
    } catch (error) {
      // 再接続できなくても、つながっている相手とは通信を続けられる
    }
  });
  renderOnlinePanel();
}
function onlineAcceptGuest(conn) {
  conn.on('open', () => {
    if (online.players.length >= ONLINE_MAX || online.inRace) {
      conn.send({ t: 'full', reason: online.inRace ? 'レース中なので入れません。少し待ってから入り直してください' : '部屋が満員です（最大4人）' });
      setTimeout(() => conn.close(), 400);
      return;
    }
    online.conns.set(conn.peer, conn);
  });
  conn.on('data', data => onlineHostReceive(conn.peer, data));
  conn.on('close', () => onlineDropGuest(conn.peer));
  conn.on('error', () => onlineDropGuest(conn.peer));
}
function onlineDropGuest(pid) {
  if (!online.conns.has(pid)) return;
  online.conns.delete(pid);
  const player = online.players.find(p => p.pid === pid);
  online.players = online.players.filter(p => p.pid !== pid);
  online.remotes.delete(pid);
  onlineBroadcast({ t: 'left', pid });
  if (player) showToast(`${player.name} が退出しました`, 'bad', 1600);
  onlineBroadcastLobby();
}
function onlineHostSettings() {
  const list = courseList();
  const def = list[selectedCourse] || COURSES[0];
  return {
    courseName: def.name, laps: raceOptions.laps,
    rivals: Math.min(raceOptions.rivals, TOTAL_RACERS - Math.max(online.players.length, 1))
  };
}
function onlineBroadcastLobby() {
  if (online.role !== 'host') return;
  if (online.players.length) online.players[0] = selfPlayer();
  online.settings = onlineHostSettings();
  onlineBroadcast({ t: 'lobby', players: online.players, settings: online.settings });
  renderOnlinePanel();
}
function onlineHostReceive(pid, msg) {
  if (!msg || typeof msg !== 'object') return;
  const now = performance.now();
  switch (msg.t) {
    case 'hello': {
      const player = cleanPlayer({ ...msg, pid });
      const index = online.players.findIndex(p => p.pid === pid);
      if (index >= 0) online.players[index] = player;
      else {
        if (online.players.length >= ONLINE_MAX) return;
        online.players.push(player);
        showToast(`${player.name} が入室しました`, 'good', 1600);
        playCue('ok');
      }
      onlineBroadcastLobby();
      break;
    }
    case 'state':
      onlineUpdateRemote(pid, msg, now);
      onlineBroadcast({ ...msg, pid }, pid);   // 他のゲストへ中継
      break;
    case 'bump':
      if (msg.to === online.myId) onlineReceiveBump({ ...msg, from: pid });
      else onlineSendTo(String(msg.to), { ...msg, from: pid });
      break;
    case 'rhit':
      onlineHostRivalHit(pid, msg);
      break;
    case 'bye':
      onlineDropGuest(pid);
      break;
    default: break;
  }
}
// ゲストがCPUライバルに当たった結果をホストが反映する（K.O.の判定はホストだけが行う）
function onlineHostRivalHit(pid, msg) {
  const racer = racers[Math.floor(num(msg.i, -1))];
  if (!racer || racer.status !== 'racing') return;
  racer.energy -= clamp(num(msg.loss), 0, 60);
  racer.lane = clamp(racer.lane + clamp(num(msg.push), -0.3, 0.3), -0.8, 0.8);
  racer.targetLane = clamp(racer.lane + Math.sign(num(msg.push)) * 0.3, -0.78, 0.78);
  if (racer.energy > 0) return;
  racer.status = 'out';
  racer.energy = 0;
  addExplosion(racer.dist, racer.lane * RIVAL_LANE_SCALE, true);
  playCue('explode');
  const player = online.players.find(p => p.pid === pid);
  showToast(`K.O.!  ${racer.name}（${player ? player.name : ''}）`, 'ko', 1300);
  onlineBroadcast({ t: 'ko', i: racers.indexOf(racer), by: pid });
}

// ---- 部屋に入る（ゲスト） ----
async function onlineJoinRoom(codeText) {
  const code = String(codeText || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (code.length !== 4) {
    setOnlineStatus('4文字の部屋コードを入れてください', true);
    return;
  }
  onlineLeave(true);
  setOnlineStatus('接続中…');
  try {
    await loadPeerJS();
  } catch (error) {
    setOnlineStatus('通信の準備に失敗しました。電波の良い所で、もう一度試してください', true);
    return;
  }
  const peer = new window.Peer({ debug: 0 });
  online.peer = peer;
  online.role = 'guest';
  online.code = code;
  peer.on('open', id => {
    online.myId = id;
    const conn = peer.connect(ONLINE_PREFIX + code, { reliable: true, serialization: 'json' });
    online.hostConn = conn;
    const timer = setTimeout(() => {
      if (online.hostConn === conn && !conn.open) onlineError({ type: 'timeout' });
    }, 15000);
    conn.on('open', () => {
      clearTimeout(timer);
      onlineSendHello();
      setOnlineStatus('入室しました。準備ができたら「準備OK」を押してください');
      renderOnlinePanel();
      playCue('ok');
    });
    conn.on('data', data => onlineGuestReceive(data));
    conn.on('close', () => {
      if (online.hostConn !== conn) return;
      onlineLeave(true);
      setOnlineStatus('部屋との接続が切れました', true);
    });
  });
  peer.on('error', err => {
    if (online.peer === peer) onlineError(err);
  });
  renderOnlinePanel();
}
function onlineSendHello() {
  onlineSendToHost({ t: 'hello', name: onlineName(), machine: myMachineInfo(), ready: online.ready });
}
function onlineGuestReceive(msg) {
  if (!msg || typeof msg !== 'object') return;
  const now = performance.now();
  switch (msg.t) {
    case 'lobby':
      online.players = Array.isArray(msg.players) ? msg.players.slice(0, ONLINE_MAX).map(cleanPlayer) : [];
      online.settings = msg.settings || null;
      renderOnlinePanel();
      break;
    case 'start':
      onlineStartRace(msg, false);
      break;
    case 'state':
      onlineUpdateRemote(String(msg.pid), msg, now);
      if (Array.isArray(msg.r)) onlineGuestRivalData(msg.r, now);
      break;
    case 'bump':
      onlineReceiveBump(msg);
      break;
    case 'ko': {
      const racer = racers[Math.floor(num(msg.i, -1))];
      if (racer && msg.by === online.myId) {
        koCount++;
        showToast(`K.O.!  ${racer.name}`, 'ko', 1300);
        playCue('ko');
      }
      break;
    }
    case 'left':
      online.remotes.delete(String(msg.pid));
      break;
    case 'full':
      onlineLeave(true);
      setOnlineStatus(String(msg.reason || '入れませんでした'), true);
      break;
    case 'bye':
      onlineLeave(true);
      setOnlineStatus('ホストが部屋を閉じました', true);
      break;
    default: break;
  }
}

// ---- 接続のエラー・退出 ----
// 相手を見つけるサーバーとの通信だけが切れた場合: すでにつながっている相手とは通信を続けられるので部屋は閉じない
const SIGNAL_ERRORS = ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'];
function onlineConnected() {
  if (online.role === 'host') return online.conns.size > 0;
  if (online.role === 'guest') return Boolean(online.hostConn && online.hostConn.open);
  return false;
}
function onlineError(err) {
  const type = err && err.type;
  if (SIGNAL_ERRORS.includes(type) && onlineConnected()) {
    if (online.role === 'host' && online.peer) {
      try {
        online.peer.reconnect();   // 新しい人が入れるよう、サーバーへの再接続を試みる
      } catch (error) {
        // 再接続できなくても、今いる人とは対戦を続けられる
      }
    }
    return;
  }
  const messages = {
    'peer-unavailable': '部屋が見つかりません。コードを確かめてください',
    network: '通信サーバーにつながりません。電波を確認してください',
    'server-error': '通信サーバーにつながりません。時間をおいて試してください',
    'socket-error': '通信サーバーにつながりません。電波を確認してください',
    'browser-incompatible': 'このブラウザは対戦に対応していません（Safari / Chrome を使ってください）',
    webrtc: 'この回線では直接つながりませんでした。同じWi-Fiにつなぐと成功しやすくなります',
    timeout: 'つながりませんでした。同じWi-Fiにつなぐか、時間をおいて試してください'
  };
  onlineLeave(true);
  setOnlineStatus(messages[type] || `接続エラー（${type || '不明'}）`, true);
}
function onlineLeave(silent) {
  if (online.role === 'host') onlineBroadcast({ t: 'bye' });
  else if (online.role === 'guest') onlineSendToHost({ t: 'bye' });
  const peer = online.peer;
  online.peer = null;
  online.role = null;
  online.hostConn = null;
  online.conns.clear();
  online.players = [];
  online.remotes.clear();
  online.ready = false;
  online.inRace = false;
  if (peer) setTimeout(() => { try { peer.destroy(); } catch (error) { /* すでに閉じている */ } }, 200);
  if (window.setRemoteShips) window.setRemoteShips([]);
  if (!silent) setOnlineStatus('部屋を出ました');
  renderOnlinePanel();
}
addEventListener('pagehide', () => {
  if (online.role) onlineLeave(true);
});

// ---- レース開始（ホストが押す → 全員が同時にカウントダウン） ----
function onlineHostStart() {
  if (online.role !== 'host' || online.players.length < 2) return;
  online.players[0] = selfPlayer();
  const def = courseList()[selectedCourse] || COURSES[0];
  const msg = {
    t: 'start', players: online.players, laps: raceOptions.laps,
    rivals: Math.min(raceOptions.rivals, TOTAL_RACERS - online.players.length),
    courseIndex: def.custom ? null : COURSES.indexOf(def),
    editor: def.custom ? editorParams : null   // 自作コースは設定だけ送り、相手の画面で同じコースを作る
  };
  onlineBroadcast(msg);
  onlineStartRace(msg, true);
}
function onlineStartRace(msg, byTap) {
  const players = Array.isArray(msg.players) ? msg.players.slice(0, ONLINE_MAX).map(cleanPlayer) : [];
  const myIndex = players.findIndex(p => p.pid === online.myId);
  if (myIndex < 0) return;
  online.players = players;
  online.inRace = true;
  online.rivals = clamp(Math.floor(num(msg.rivals)), 0, 15);
  TOTAL_LAPS = clamp(Math.floor(num(msg.laps, 3)), 1, 5);
  raceMode = 'online';
  gp.active = false;
  if (msg.editor) {
    customCourse = generateCourse(sanitizeEditorParams(msg.editor));
    applyCourse(courseList().length - 1);
  } else {
    applyCourse(clamp(Math.floor(num(msg.courseIndex)), 0, COURSES.length - 1));
  }
  // 相手のマシン（届いた位置で動かす）
  online.remotes.clear();
  players.forEach((p, index) => {
    if (p.pid === online.myId) return;
    online.remotes.set(p.pid, {
      pid: p.pid, name: p.name, color: p.machine.color, machine: p.machine,
      d: 0, x: ONLINE_START_LANES[index] || 0, s: 0, tilt: 0, energy: 100, status: 'racing',
      fin: null, falling: false, opacity: 1, started: true,
      target: { d: 0, x: ONLINE_START_LANES[index] || 0, s: 0, at: performance.now() }
    });
  });
  if (window.setRemoteShips) window.setRemoteShips([...online.remotes.values()]);
  if (paused) closePause();
  selectingMachine = false;
  selectOverlay.hidden = true;
  wrapEl.classList.remove('selecting');
  if (byTap && raceOptions.control === 'tilt') enableTilt();
  // ゲストは通信で始まる（画面をタップした操作ではない）ので、音声エンジンは作り直さない
  beginRace(!byTap);
  car.x = ONLINE_START_LANES[myIndex] || 0;
  showToast(`ONLINE ${players.length}人対戦`, 'good', 1500);
}

// ---- 位置のやり取り ----
const STATUS_CODES = ['racing', 'finished', 'retired'];
function onlineUpdateRemote(pid, msg, now) {
  const r = online.remotes.get(pid);
  if (!r) return;
  r.target = { d: num(msg.d), x: clamp(num(msg.x), -1.7, 1.7), s: clamp(num(msg.s), 0, 40), at: now };
  r.tilt = clamp(num(msg.tl), -1, 1);
  r.status = STATUS_CODES[msg.st] || 'racing';
  r.fin = msg.fin === null || msg.fin === undefined ? null : num(msg.fin);
  r.falling = Boolean(msg.f);
  r.opacity = clamp(num(msg.o, 1), 0, 1);
  r.energy = clamp(num(msg.e, 100), 0, 100);
  r.boosting = Boolean(msg.b);
}
// ゲスト: ホストから届いたCPUライバルの位置
function onlineGuestRivalData(list, now) {
  list.forEach((item, i) => {
    const racer = racers[i];
    if (!racer || !Array.isArray(item)) return;
    const status = ['racing', 'out', 'absent'][item[2]] || 'racing';
    if (racer.status === 'racing' && status === 'out') {
      addExplosion(racer.dist, racer.lane * RIVAL_LANE_SCALE, true);
      playCue('explode');
    }
    racer.status = status;
    racer.net = { d: num(item[0]), lane: clamp(num(item[1]), -0.9, 0.9), s: num(item[3]), at: now };
    racer.energy = clamp(num(item[4], 100), 0, 100);
  });
}
function onlineIsGuest() {
  return online.role === 'guest' && raceMode === 'online' && online.inRace;
}
// ゲストのCPUライバルは自分では考えず、ホストの位置をなめらかに追いかける
function onlineGuestRivals(dt, now) {
  const follow = 1 - Math.pow(0.8, dt);
  racers.forEach(racer => {
    const n = racer.net;
    if (!n || racer.status !== 'racing') return;
    const predicted = n.d + n.s * clamp(now - n.at, 0, 500) / 16.667;
    racer.dist += (predicted - racer.dist) * follow;
    racer.speed = n.s;
    racer.lane += (n.lane - racer.lane) * follow;
    racer.targetLane = n.lane;
    if (racer.dist >= TOTAL_DISTANCE && !racer.finishAt) racer.finishAt = now;
  });
}
// ゲストがCPUライバルに当たったことをホストへ知らせる
function onlineSendRivalHit(racer, loss, push) {
  onlineSendToHost({ t: 'rhit', i: racers.indexOf(racer), loss: Math.round(loss * 10) / 10, push: Math.round(push * 1000) / 1000 });
}
// 毎フレーム: 自分の位置を送り、相手の位置をなめらかに更新する
function onlineTick(now) {
  // 時間差は 0〜3フレーム分に収める（時計のずれで位置の計算が暴れないように）
  const dt = clamp((now - (online.lastTick || now)) / 16.667, 0, 3);
  online.lastTick = now;
  if (!online.role || raceMode !== 'online' || !online.inRace) return;
  const follow = 1 - Math.pow(0.75, dt);
  online.remotes.forEach(r => {
    const t = r.target;
    const predicted = t.d + (r.status === 'racing' ? t.s * clamp(now - t.at, 0, 500) / 16.667 : 0);
    r.d += (predicted - r.d) * follow;
    r.x += (t.x - r.x) * follow;
    r.s = t.s;
  });
  if (now - online.lastSend < ONLINE_SEND_MS) return;
  online.lastSend = now;
  const msg = {
    t: 'state', pid: online.myId,
    d: Math.round(car.dist * 10) / 10, x: Math.round(car.x * 1000) / 1000, s: Math.round(car.speed * 100) / 100,
    tl: Math.round(car.tilt * 100) / 100, st: Math.max(0, STATUS_CODES.indexOf(car.status)),
    fin: finishTime, f: car.fallTimer > 0 ? 1 : 0, o: Math.round(playerOpacity(now) * 100) / 100,
    e: Math.round(car.energy), b: keys.boost ? 1 : 0
  };
  if (online.role === 'host') {
    // ホストはCPUライバルの位置も一緒に配る
    msg.r = racers.map(racer => [
      Math.round(racer.dist), Math.round(racer.lane * 1000) / 1000,
      racer.status === 'racing' ? 0 : (racer.status === 'out' ? 1 : 2),
      Math.round(racer.speed * 10) / 10, Math.round(racer.energy)
    ]);
    onlineBroadcast(msg);
  } else {
    onlineSendToHost(msg);
  }
}
// 画面に出す相手の一覧（ミニマップ・順位・リザルト用）
function onlineRemoteList() {
  if (raceMode !== 'online' || !online.role) return [];
  return [...online.remotes.values()].filter(r => r.started);
}

// ---- 人間同士の接触 ----
// 当てた側が自分に反動をかけ、相手には「当たった」と知らせる。相手は自分の画面で反動を受ける
function onlineCheckRemoteContact(now, m) {
  if (raceMode !== 'online' || car.collisionCooldown > 0 || car.air || car.respawnTimer > 0) return;
  const myLane = car.x * PLAYER_LANE_SCALE;
  for (const r of online.remotes.values()) {
    if (r.status !== 'racing' || r.falling || r.opacity < 0.9) continue;
    const gap = r.d - car.dist;
    if (Math.abs(gap) > 26) continue;
    const theirLane = r.x * PLAYER_LANE_SCALE;
    if (Math.abs(theirLane - myLane) > 0.16) continue;
    const push = myLane <= theirLane ? 1 : -1;
    const attacking = Math.abs(gap) < 22 && (car.steerAxis * push > 0.3 || car.slide * push > 0.004);
    const force = 0.6 + car.speed / 20 + Math.abs(car.speed - r.s) / 10;
    car.collisionCooldown = 40;
    car.slide -= push * (attacking ? 0.05 : 0.12);
    if (gap >= 0) car.speed *= 1 - (attacking ? 0.08 : 0.2) * m.impact;
    else car.speed += 0.6;
    car.shake = attacking ? 10 : 8;
    spawnSparks(W / 2 + push * 20, H - 83, attacking ? 12 : 7);
    breakCombo('接触');
    playCue(attacking ? 'attack' : 'contact');
    if (attacking) {
      car.attackCount++;
      showToast(`SIDE ATTACK!  ${r.name}`, 'ko', 1100);
    }
    onlineSendTo(r.pid, { t: 'bump', to: r.pid, from: online.myId, push, force: Math.round(force * 100) / 100, atk: attacking ? 1 : 0, rear: gap < 0 ? 1 : 0 });
    applyDamage(5 * m.damage * Math.min(force, 1.8) * (attacking ? 0.55 : 1), now, 'contact');
    break;
  }
}
function onlineReceiveBump(msg) {
  if (msg.to !== online.myId || car.status !== 'racing' || car.respawnTimer > 0) return;
  if (car.collisionCooldown > 0) return;   // 同じ接触を自分の画面でも処理済み
  const m = effectiveMachine();
  const attacking = Boolean(msg.atk);
  const force = clamp(num(msg.force, 1), 0, 3);
  car.collisionCooldown = 40;
  car.slide += clamp(num(msg.push), -1, 1) * (attacking ? 0.2 : 0.1) * m.impact;
  if (msg.rear) car.speed *= 1 - 0.15 * m.impact;   // 後ろから押された
  car.shake = attacking ? 10 : 8;
  spawnSparks(W / 2, H - 83, 8);
  breakCombo('接触');
  playCue(attacking ? 'attack' : 'contact');
  const from = online.remotes.get(String(msg.from));
  if (attacking) showToast(`${from ? from.name : 'ライバル'} の体当たり！`, 'bad', 1100);
  applyDamage(5 * m.damage * Math.min(force, 1.8) * (attacking ? 1.7 : 1), performance.now(), 'contact');
}

// ===== ロビー画面 =====
const onlineEls = {
  status: document.getElementById('onlineStatus'),
  name: /** @type {HTMLInputElement} */ (document.getElementById('onlineName')),
  entry: document.getElementById('onlineEntry'),
  room: document.getElementById('onlineRoom'),
  code: /** @type {HTMLInputElement} */ (document.getElementById('onlineCode')),
  roomCode: document.getElementById('onlineRoomCode'),
  players: document.getElementById('onlinePlayers'),
  settings: document.getElementById('onlineSettings'),
  start: /** @type {HTMLButtonElement} */ (document.getElementById('onlineStart')),
  ready: /** @type {HTMLButtonElement} */ (document.getElementById('onlineReady')),
  machine: document.getElementById('onlineMachine')
};
function setOnlineStatus(text, bad) {
  onlineEls.status.textContent = text;
  onlineEls.status.classList.toggle('bad', Boolean(bad));
}
function onlineInviteLink() {
  return `${location.origin}${location.pathname}?openExternalBrowser=1#room=${online.code}`;
}
function renderOnlinePanel() {
  onlineEls.name.value = onlineEls.name.value || onlineProfile.name || '';
  const inRoom = Boolean(online.role);
  onlineEls.entry.hidden = inRoom;
  onlineEls.room.hidden = !inRoom;
  document.getElementById('onlineNameField').hidden = inRoom;   // 部屋に入ったら名前欄は畳んで、スタートボタンを見やすくする
  onlineEls.machine.textContent = `${currentMachine().name}（${currentMachine().type}）`;
  if (!inRoom) return;
  onlineEls.roomCode.textContent = online.code;
  onlineEls.players.innerHTML = '';
  online.players.forEach((p, i) => {
    const machine = MACHINES.find(def => def.id === p.machine.id) || MACHINES[0];
    const li = makeEl('li', p.pid === online.myId ? 'me' : '');
    const dot = makeEl('i');
    dot.style.background = p.machine.color;
    li.appendChild(dot);
    li.appendChild(document.createTextNode(`${i === 0 ? '👑 ' : ''}${p.name}${p.pid === online.myId ? '（あなた）' : ''} — ${machine.name}`));
    li.appendChild(makeEl('b', '', i === 0 || p.ready ? '準備OK' : '待機中'));
    onlineEls.players.appendChild(li);
  });
  const s = online.role === 'host' ? onlineHostSettings() : online.settings;
  onlineEls.settings.textContent = s
    ? `コース: ${s.courseName} / ${s.laps}周 / CPU ${s.rivals}台${online.role === 'host' ? '（②コース・⚙設定で変更）' : ''}`
    : '';
  const host = online.role === 'host';
  onlineEls.start.hidden = !host;
  onlineEls.start.disabled = online.players.length < 2;
  onlineEls.start.textContent = online.players.length < 2 ? '友だちの入室を待っています…' : `${online.players.length}人でスタート ▶`;
  onlineEls.ready.hidden = host;
  onlineEls.ready.textContent = online.ready ? '準備OK ✔（押すと取り消し）' : '準備OK';
  onlineEls.ready.classList.toggle('primary', !online.ready);
}
onlineEls.name.addEventListener('change', () => {
  onlineProfile.name = onlineEls.name.value.trim().slice(0, 10);
  writeStore('fzx-online', onlineProfile);
  if (online.role === 'host') onlineBroadcastLobby();
  if (online.role === 'guest') onlineSendHello();
});
document.getElementById('onlineCreate').addEventListener('click', () => {
  startAudio();
  onlineCreateRoom();
});
document.getElementById('onlineJoin').addEventListener('click', () => {
  startAudio();
  onlineJoinRoom(onlineEls.code.value);
});
document.getElementById('onlineLeave').addEventListener('click', () => {
  onlineLeave(false);
  playCue('ui');
});
onlineEls.start.addEventListener('click', () => onlineHostStart());
onlineEls.ready.addEventListener('click', () => {
  online.ready = !online.ready;
  // この操作の中で、音と傾きセンサーの許可を済ませておく（スタートは通信で始まるため）
  startAudio();
  if (online.ready && raceOptions.control === 'tilt') enableTilt();
  onlineSendHello();
  renderOnlinePanel();
  playCue('ui');
});
document.getElementById('onlineChangeMachine').addEventListener('click', () => {
  playCue('ui');
  setFocusRow(2);
});
document.getElementById('onlineInvite').addEventListener('click', () => {
  const url = onlineInviteLink();
  const text = `NEON RACERで対戦しよう！ 部屋コード ${online.code}`;
  const nav = /** @type {any} */ (navigator);
  if (nav.share) {
    nav.share({ title: 'NEON RACER', text, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(`${text}\n${url}`).then(() => showToast('招待リンクをコピーしました', 'good', 1600)).catch(() => {});
  }
});
document.getElementById('onlineLine').addEventListener('click', () => {
  const text = `NEON RACERで対戦しよう！ 部屋コード ${online.code}\n${onlineInviteLink()}`;
  window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, '_blank');
});
// 招待リンク（#room=XXXX）で開かれたら、オンライン対戦の画面を出してコードを入れておく
function onlineCheckInvite() {
  const match = /#room=([A-Za-z0-9]{4})/.exec(location.hash);
  if (!match) return;
  selectedMode = MODES.findIndex(mode => mode.id === 'online');
  onlineEls.code.value = match[1].toUpperCase();
  setTab('online');
  updateSetupUI();
  setOnlineStatus(`部屋 ${onlineEls.code.value} に招待されています。名前を入れて「部屋に入る」を押してください`);
  history.replaceState(null, '', location.pathname + location.search);
}
