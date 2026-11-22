// @ts-check
// コース形状・記録の保存・画面メッセージ・HUD・ダメージ/リタイア・リザルト・ポイント獲得
// ※ ファイルは index.html に書いた順に読み込まれ、変数や関数はファイル間で共有される
// ===== コース形状・ギミック =====
// 任意のコース定義での曲がり・起伏（エディタのプレビューでも使う）
function waveOf(terms, lap, distance) {
  const phase = ((distance % lap) / lap) * Math.PI * 2;
  let sum = 0;
  for (const [amp, harmonic, offset] of terms) sum += Math.sin(phase * harmonic + offset) * amp;
  return sum;
}
function curveCenterAt(distance) {
  return waveOf(course.curve, LAP_DISTANCE, distance);
}
function elevationAt(distance) {
  return waveOf(course.elev, LAP_DISTANCE, distance);
}
function lapProgress(distance) {
  return ((distance % LAP_DISTANCE) + LAP_DISTANCE) % LAP_DISTANCE;
}
// ジャンプ台の飛行高さ（ワールド単位）。距離だけで決まる放物線
function airHeightAt(distance) {
  const prog = lapProgress(distance);
  for (const zone of TRACK_ZONES) {
    if (zone.type !== 'jump' || prog < zone.start || prog >= zone.end) continue;
    const t = (prog - zone.start) / (zone.end - zone.start);
    return zone.height * 4 * t * (1 - t);
  }
  return 0;
}
function zoneAt(distance, type) {
  const prog = lapProgress(distance);
  return TRACK_ZONES.find(zone => zone.type === type && prog >= zone.start && prog < zone.end) || null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getRaceRank() {
  if (finalRank !== null) return finalRank;
  return 1 + racers.filter(racer => racer.status === 'racing' && racer.dist > car.dist).length
    + onlineRemoteList().filter(r => r.status !== 'retired' && r.d > car.dist).length;
}
function fieldSize() {
  return 1 + racers.filter(racer => racer.status !== 'absent').length + onlineRemoteList().length;
}

function formatTime(milliseconds) {
  milliseconds = Math.max(0, milliseconds);
  const centiseconds = Math.floor(milliseconds / 10) % 100;
  const seconds = Math.floor(milliseconds / 1000) % 60;
  const minutes = Math.floor(milliseconds / 60000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

// ===== 記録の保存（ブラウザ内） =====
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // 保存できない環境（プライベートモード等）では記録を残さない
  }
}
const records = loadJSON('fzx-records', {});
const courseRecord = id => records[id] || null;

// ===== 画面中央のメッセージ =====
const bannerEl = document.getElementById('banner');
const toastEl = document.getElementById('toast');
function flashMessage(el, text, cls, ms) {
  el.className = '';
  void el.offsetWidth;
  el.textContent = text;
  el.style.setProperty('--dur', `${ms}ms`);
  el.className = `show ${cls || ''}`;
}
const showBanner = (text, cls, ms = 1200) => flashMessage(bannerEl, text, cls, ms);
const showToast = (text, cls, ms = 1400) => flashMessage(toastEl, text, cls, ms);

// ===== HUD =====
function nearestRivals() {
  let ahead = null, behind = null;
  racers.forEach(racer => {
    if (racer.status !== 'racing') return;
    const d = racer.dist - car.dist;
    if (d > 0 && (!ahead || d < ahead.d)) ahead = { d, racer };
    if (d < 0 && (!behind || d > behind.d)) behind = { d, racer };
  });
  return { ahead, behind };
}
function raceElapsed(now) {
  if (!raceStarted) return 0;
  if (finishTime !== null) return finishTime;
  if (car.status === 'retired') return finishAt - raceStartedAt;
  return now - raceStartedAt;
}
// 大きな順位表示（順位が上がると緑、下がると赤で一瞬拡大）
const bigRankEl = document.getElementById('bigRank');
const controlsHintEl = document.getElementById('controlsHint');
const rankState = { last: null, flashUntil: 0, dir: '' };
function ordinalSuffix(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
}
function updateBigRank(now) {
  bigRankEl.hidden = raceMode === 'ta';
  if (raceMode === 'ta') return;
  const rank = getRaceRank();
  if (rankState.last !== null && rank !== rankState.last && raceStarted) {
    rankState.dir = rank < rankState.last ? 'up' : 'down';
    rankState.flashUntil = now + 450;
  }
  rankState.last = rank;
  document.getElementById('rankNum').textContent = rank;
  document.getElementById('rankSuf').textContent = ordinalSuffix(rank);
  document.getElementById('rankOf').textContent = `/${fieldSize()}`;
  bigRankEl.classList.toggle('first', rank === 1);
  bigRankEl.classList.toggle('podium', rank === 2 || rank === 3);
  const flashing = now < rankState.flashUntil;
  bigRankEl.classList.toggle('up', flashing && rankState.dir === 'up');
  bigRankEl.classList.toggle('down', flashing && rankState.dir === 'down');
}
function updateRaceHud(now) {
  const lap = clamp(Math.floor(car.dist / LAP_DISTANCE) + 1, 1, TOTAL_LAPS);
  raceHud.lap.textContent = lap === TOTAL_LAPS ? 'FINAL LAP' : `LAP ${lap} / ${TOTAL_LAPS}`;
  raceHud.lap.classList.toggle('final', lap === TOTAL_LAPS);
  raceHud.rank.textContent = raceMode === 'ta' ? 'SOLO' : '';
  updateBigRank(now);
  // 操作説明は最初のレースのカウントダウン中だけ（走り出したら消す）
  controlsHintEl.classList.toggle('hide', !(countdown.active && !hintSeen));
  raceHud.time.textContent = `TIME ${formatTime(raceElapsed(now))}`;
  const modeName = raceMode === 'gp' ? `GP ${gp.index + 1}/${COURSES.length}`
    : (raceMode === 'ta' ? 'TIME ATTACK' : (raceMode === 'online' ? `ONLINE ${onlineRemoteList().length + 1}P` : 'SINGLE RACE'));
  raceHud.rivals.textContent = `${modeName} · ${course.name}`;

  let gapHtml = '';
  if (raceMode === 'ta') {
    const rec = courseRecord(course.id);
    gapHtml = `BEST ${rec ? formatTime(rec.best) : '--:--.--'} · GOLD ${formatTime(taTargets()[0].time)}`;
    if (ghostState.visible && raceStarted && car.status === 'racing') {
      const diff = (car.dist - ghostState.dist) / (Math.max(car.speed, 8) * 60);
      gapHtml += ` <span class="${diff >= 0 ? 'gain' : 'lose'}">GHOST ${diff >= 0 ? '-' : '+'}${Math.abs(diff).toFixed(2)}s</span>`;
    }
  } else if (car.status === 'racing' && raceStarted) {
    const { ahead, behind } = nearestRivals();
    const perSecond = Math.max(car.speed, 8) * 60;
    if (ahead) gapHtml += `<span class="lose">▲ ${ahead.racer.name} +${(ahead.d / perSecond).toFixed(2)}s</span>`;
    if (behind) gapHtml += ` <span class="gain">▼ ${(-behind.d / perSecond).toFixed(2)}s</span>`;
  }
  raceHud.gap.innerHTML = gapHtml;
  const energyText = document.getElementById('energyText');
  energyText.textContent = car.energy <= 0 && car.status === 'racing'
    ? 'ENERGY 0 — DANGER! PITへ'
    : `ENERGY: ${Math.floor(car.energy)}%`;
  energyText.classList.toggle('low', car.energy < 25);
  energyFill.style.width = `${car.energy}%`;
  energyFill.classList.toggle('low', car.energy < 25);
}

// ===== ダメージ・リタイア・K.O. =====
function addExplosion(dist, lane, big) {
  effects.explosions.push({ dist, lane, big, at: performance.now() });
}
// ===== エネルギーとリタイアのルール =====
// ・壁（ガードビーム）・ライバルとの接触・地雷・荒れ地でエネルギーが減る（PITの緑レーンで回復）
// ・エネルギーが0になると「DANGER」状態。さらにダメージを OVERLOAD_LIMIT ぶん受けるとリタイア
//   （目安: 接触1〜2回、地雷1回、壁に約3秒擦る）
const OVERLOAD_LIMIT = 8;
const RETIRE_REASONS = {
  wall: 'エネルギー0のまま、壁（ガードビーム）に擦り続けた',
  contact: 'エネルギー0の状態で、ライバルと接触した',
  mine: 'エネルギー0の状態で、地雷に触れた',
  rough: 'エネルギー0の状態で、荒れ地（ROUGH）を走った'
};
function applyDamage(amount, now, cause) {
  if (car.status !== 'racing' || amount <= 0 || car.respawnTimer > 0) return;
  car.damageFlash = Math.min(1, car.damageFlash + amount / 8);
  if (car.energy <= 0) {
    car.overload += amount;
    if (car.overload >= effectiveMachine().overloadLimit) retirePlayer(now, cause);
    return;
  }
  car.energy = Math.max(0, car.energy - amount);
  if (car.energy <= 0) {
    car.overload = 0;
    showBanner('ENERGY 0', 'bad', 1600);
    showToast('DANGER! 次のダメージでリタイア — PIT（緑のレーン）で回復を', 'bad', 3200);
  }
}
function knockOut(racer) {
  racer.status = 'out';
  racer.energy = 0;
  koCount++;
  addExplosion(racer.dist, racer.lane * RIVAL_LANE_SCALE, true);
  showToast(`K.O.!  ${racer.name}`, 'ko', 1300);
  playCue('explode');
  playCue('ko');
}
function retirePlayer(now, cause) {
  if (car.status !== 'racing') return;
  car.status = 'retired';
  car.retireReason = RETIRE_REASONS[cause] || 'エネルギーが尽きた';
  car.energy = 0;
  car.shake = 12;
  finishAt = now;
  addExplosion(car.dist, car.x * PLAYER_LANE_SCALE, true);
  showBanner('RETIRED', 'bad', 2200);
  showToast(car.retireReason, 'bad', 2400);
  playCue('explode');
  playCue('retire');
  releaseAllInputs();
  resultsAt = now + 2400;
}
function finishRace(now) {
  if (car.status !== 'racing') return;
  finalRank = raceMode === 'ta' ? 1 : getRaceRank();
  car.status = 'finished';
  finishAt = now;
  finishTime = now - raceStartedAt;
  const bestLap = Math.min(...lapTimes);
  const rec = courseRecord(course.id);
  lastResult = { newBest: !rec || finishTime < rec.best, newLap: !rec || bestLap < rec.bestLap };
  if (lastResult.newBest || lastResult.newLap) {
    records[course.id] = {
      best: lastResult.newBest ? finishTime : rec.best,
      bestLap: lastResult.newLap ? bestLap : rec.bestLap,
      machine: lastResult.newBest ? currentMachine().name : rec.machine
    };
    saveJSON('fzx-records', records);
  }
  if (raceMode === 'ta' && (!ghostData || finishTime < ghostData.time)) {
    ghostData = { time: finishTime, machine: currentMachine().id, samples: ghostRecord.slice() };
    saveJSON(`fzx-ghost-${course.id}`, ghostData);
  }
  showBanner(raceMode !== 'ta' && finalRank === 1 ? 'WINNER!' : 'FINISH!', 'finish', 2600);
  playCue('finish');
  if (lastResult.newBest) setTimeout(() => {
    playCue('record');
  }, 1800);
  car.shake = 4;
  releaseAllInputs();
  resultsAt = now + 2800;
}

// ===== リザルト =====
function computeStandings() {
  const list = [{
    name: raceMode === 'online' ? onlineName() : 'YOU', isPlayer: true, remote: false, finishAt: car.status === 'finished' ? finishAt : null,
    dist: car.dist, out: car.status === 'retired'
  }];
  // オンライン対戦の相手（ゴールタイムはレース開始からの時間で届くので、自分の時計に直して比べる）
  onlineRemoteList().forEach(r => list.push({
    name: r.name, isPlayer: false, remote: true, finishAt: r.fin !== null ? raceStartedAt + r.fin : null,
    dist: r.d, out: r.status === 'retired'
  }));
  racers.forEach(racer => {
    if (racer.status === 'absent') return;
    list.push({ name: racer.name, isPlayer: false, remote: false, finishAt: racer.finishAt, dist: racer.dist, out: racer.status === 'out' });
  });
  list.sort((a, b) => {
    if (a.out !== b.out) return a.out ? 1 : -1;
    if (a.finishAt && b.finishAt) return a.finishAt - b.finishAt;
    if (a.finishAt || b.finishAt) return a.finishAt ? -1 : 1;
    return b.dist - a.dist;
  });
  return list;
}
// ===== ポイント獲得 =====
const RANK_POINTS = [300, 220, 170, 130, 110, 95, 85, 75, 65, 55, 50, 45, 40, 35, 30, 30];
const DIFFICULTY_BONUS = { 0.9: 0.8, 1: 1, 1.06: 1.25, 1.12: 1.5 };
// タイムアタックの目標タイム（平均速度で決める。高難度コースは少し甘め）
function taTargets() {
  const total = course.lap * TOTAL_LAPS;
  const timeAt = speed => total / (speed * 60) * 1000 * (course.difficulty || 1);
  return [
    { name: 'GOLD', time: timeAt(15.4), points: 200 },
    { name: 'SILVER', time: timeAt(14.3), points: 120 },
    { name: 'BRONZE', time: timeAt(13.0), points: 60 }
  ];
}
function awardPoints(playerPos, fieldCount, retired, gpFinalRank, standings = []) {
  /** @type {Array<[string, number]>} */
  const items = [];
  const lapFactor = TOTAL_LAPS / 3;   // 周回数が多いほど多くもらえる
  if (raceMode === 'ta') {
    if (!retired) {
      const medal = taTargets().find(target => finishTime <= target.time);
      if (medal) items.push([`${medal.name}タイム達成`, Math.round(medal.points * lapFactor)]);
      if (lastResult.newBest) items.push(['自己ベスト更新', 40]);
    }
  } else {
    if (!retired) {
      // ライバルが少ないレースや易しい難易度では少なめ
      const fieldFactor = 0.25 + 0.75 * clamp((fieldCount - 1) / 15, 0, 1);
      const diffFactor = (DIFFICULTY_BONUS[raceOptions.difficulty] || 1) * (course.difficulty || 1);
      items.push([`${playerPos}位でゴール`, Math.round((RANK_POINTS[playerPos - 1] || 30) * fieldFactor * lapFactor * diffFactor)]);
    }
    if (koCount) items.push([`K.O. ×${koCount}`, koCount * 25]);
    if (car.attackCount) items.push([`体当たり ×${car.attackCount}`, Math.min(60, car.attackCount * 5)]);
    // オンライン: 自分より後ろでゴールした（またはリタイアした）友だちの数だけボーナス
    const beaten = retired ? 0 : standings.slice(playerPos).filter(entry => entry.remote).length;
    if (beaten) items.push([`対戦相手に勝利 ×${beaten}`, beaten * 80]);
  }
  if (car.maxCombo >= 5) items.push([`ドリドリ最大 ×${car.maxCombo}`, Math.min(80, car.maxCombo * 4)]);
  if (gpFinalRank) items.push([`GP総合 ${gpFinalRank}位`, [500, 300, 200][gpFinalRank - 1] || 80]);
  if (!items.length) items.push(['参加賞', 10]);
  const total = items.reduce((sum, [, pts]) => sum + pts, 0);
  progress.points += total;
  saveProgress();
  updatePointsBadges();
  return { items, total };
}
function showResults() {
  const retired = car.status === 'retired';
  const standings = raceMode === 'ta' ? [] : computeStandings();
  const playerPos = standings.findIndex(entry => entry.isPlayer) + 1;
  const bestLap = lapTimes.length ? Math.min(...lapTimes) : null;
  const rec = courseRecord(course.id);
  let title = 'FINISH';
  if (retired) title = 'RETIRED';
  else if (raceMode === 'ta') title = lastResult.newBest ? 'NEW RECORD!' : 'TIME ATTACK';
  else if (playerPos === 1) title = 'WINNER!';

  let gpHtml = '';
  let gpFinalRank = null;
  let buttons = `<button class="primary" type="button" data-act="retry">もう一度走る</button>
    <button type="button" data-act="menu">メニューへ</button>`;
  if (raceMode === 'online') {
    // オンライン: 全体の順位表（人間は全員、CPUは上位だけ）
    const rows = standings.map((entry, i) => ({ ...entry, rank: i + 1 }))
      .filter(row => row.rank <= 6 || row.remote || row.isPlayer)
      .map(row => `<tr class="${row.isPlayer ? 'me' : (row.remote ? 'human' : '')}"><td>${row.rank}</td><td>${escapeHtml(row.name)}${row.remote ? ' 👤' : ''}</td>
        <td>${row.out ? 'RETIRE' : (row.finishAt ? formatTime(row.finishAt - raceStartedAt) : '走行中')}</td></tr>`).join('');
    gpHtml = `<div class="gp-title">ONLINE 対戦結果</div>
      <table class="gp-table"><tr><th>#</th><th>NAME</th><th>タイム</th></tr>${rows}</table>`;
    buttons = '<button class="primary" type="button" data-act="lobby">ロビーに戻る</button>';
  }
  if (raceMode === 'gp') {
    const racePoints = {};
    standings.forEach((entry, i) => {
      const pts = entry.out ? 0 : (GP_POINTS[i] || 0);
      racePoints[entry.name] = pts;
      gp.points[entry.name] = (gp.points[entry.name] || 0) + pts;
    });
    const table = Object.entries(gp.points).sort((a, b) => b[1] - a[1]);
    const playerTotal = table.findIndex(([name]) => name === 'YOU') + 1;
    const last = gp.index >= COURSES.length - 1;
    if (last) gpFinalRank = playerTotal;
    const rows = table.map(([name, pts], i) => ({ name, pts, rank: i + 1 }))
      .filter(row => row.rank <= 8 || row.name === 'YOU')
      .map(row => `<tr class="${row.name === 'YOU' ? 'me' : ''}"><td>${row.rank}</td><td>${row.name}</td>
        <td>+${racePoints[row.name] || 0}</td><td>${row.pts}</td></tr>`).join('');
    gpHtml = `<div class="gp-title">${last
      ? (playerTotal === 1 ? '🏆 GRAND PRIX 総合優勝！' : `GRAND PRIX 最終結果: 総合 ${playerTotal} 位`)
      : `GRAND PRIX 第${gp.index + 1}戦 終了（総合 ${playerTotal} 位）`}</div>
      <table class="gp-table"><tr><th>#</th><th>NAME</th><th>今回</th><th>合計</th></tr>${rows}</table>`;
    buttons = last
      ? '<button class="primary" type="button" data-act="menu">メニューへ</button>'
      : `<button class="primary" type="button" data-act="next">次のレースへ ▶</button>
         <button type="button" data-act="menu">GPをやめる</button>`;
  }

  const retireHtml = retired ? `<div class="retire-reason"><b>リタイアの理由:</b> ${car.retireReason}<br>
    <b>ヒント:</b> エネルギーは壁・接触・地雷・荒れ地で減り、<span class="pit-word">PIT（緑のレーン）</span>を走ると回復します。
    0になると画面が赤く点滅し警告音が鳴ります。その状態でさらにダメージを受けるとリタイアです。</div>` : '';
  const badges = [];
  if (!retired && lastResult.newBest) badges.push('NEW COURSE RECORD!');
  if (!retired && lastResult.newLap) badges.push('NEW LAP RECORD!');
  const lapRows = lapTimes.map((time, i) =>
    `<li class="${time === bestLap ? 'best' : ''}">LAP ${i + 1}<span>${formatTime(time)}</span></li>`).join('');
  const award = awardPoints(playerPos, standings.length, retired, gpFinalRank, standings);
  const pointsHtml = `<div class="points-earned"><span class="total">+0 PT</span> 獲得（所持 ${progress.points} PT）
    <ul>${award.items.map(([label, pts]) => `<li>${label} +${pts}</li>`).join('')}</ul>
    ${canBuyPart() ? '<div class="hint">▶ メニューの「🔧 パーツ・色」で新しいパーツを買えます</div>' : ''}</div>`;

  raceHud.card.innerHTML = `
    <div class="result-title ${retired ? 'bad' : ''}">${title}</div>
    <div class="result-sub">${escapeHtml(course.name)} · ${currentMachine().name}</div>
    <div class="result-grid">
      ${raceMode !== 'ta' ? `<div><span>順位</span><strong>${retired ? '—' : `${playerPos} / ${standings.length}`}</strong></div>` : ''}
      <div><span>タイム</span><strong>${retired ? '--:--.--' : formatTime(finishTime)}</strong></div>
      <div><span>ベストラップ</span><strong>${bestLap !== null ? formatTime(bestLap) : '--:--.--'}</strong></div>
      ${raceMode !== 'ta' ? `<div><span>K.O.</span><strong>${koCount}</strong></div>` : ''}
    </div>
    ${retireHtml}
    ${badges.map(text => `<div class="badge">${text}</div>`).join('')}
    ${pointsHtml}
    ${lapRows ? `<ul class="lap-list">${lapRows}</ul>` : ''}
    <div class="result-rec">コースレコード ${rec ? `${formatTime(rec.best)}（${rec.machine}）` : '--:--.--'}
      / ベストラップ ${rec ? formatTime(rec.bestLap) : '--:--.--'}</div>
    ${gpHtml}
    <div class="result-buttons">${buttons}</div>`;
  raceHud.overlay.hidden = false;
  /** @type {NodeListOf<HTMLButtonElement>} */ (raceHud.card.querySelectorAll('button[data-act]')).forEach(button => {
    button.addEventListener('click', () => resultAction(button.dataset.act));
  });
  // 獲得ポイントをカウントアップ表示
  const totalEl = raceHud.card.querySelector('.points-earned .total');
  const countFrom = performance.now();
  const countUp = () => {
    const k = Math.min(1, (performance.now() - countFrom) / 900);
    totalEl.textContent = `+${Math.round(award.total * k)} PT`;
    if (k < 1) requestAnimationFrame(countUp);
  };
  requestAnimationFrame(countUp);
  setTimeout(() => playCue('points'), 250);
}
function resultAction(action) {
  if (action === 'retry') beginRace();
  if (action === 'next') {
    gp.index++;
    applyCourse(gp.index);
    beginRace();
  }
  if (action === 'menu') {
    gp.active = false;
    openSetup();
  }
  if (action === 'lobby') onlineBackToLobby();
}
// オンライン対戦のロビー（部屋の画面）へ戻る。ホストがスタートすると全員が次のレースへ
function onlineBackToLobby() {
  online.inRace = false;
  openSetup();
  selectedMode = MODES.findIndex(mode => mode.id === 'online');
  focusRow = 2;
  setTab('online');
  updateSetupUI();
  if (online.role === 'host') onlineBroadcastLobby();
}

function resetRace() {
  Object.assign(car, CAR_DEFAULTS);
  car.sparks.length = 0;
  racers.forEach((racer, index) => Object.assign(racer, gridRacer(index)));
  lapTimes.length = 0;
  completedLaps = 0;
  finishTime = null;
  finishAt = null;
  finalRank = null;
  resultsAt = null;
  koCount = 0;
  lastResult = { newBest: false, newLap: false };
  raceStartedAt = performance.now();
  lapStartedAt = raceStartedAt;
  raceStarted = false;
  mineHits.clear();
  zoneHits.clear();
  effects.explosions.length = 0;
  fireworks.length = 0;
  ghostRecord = [];
  countdown.active = false;
  raceHud.overlay.hidden = true;
  releaseAllInputs();
  updateRaceHud(raceStartedAt);
}
function beginRace(keepAudio) {
  // レースごとに音声エンジンを作り直し、前のレースで溜まった処理を捨てる（音飛び・遅れ対策）。
  // オンライン対戦のゲストは通信でスタートする（タップ操作ではない）ので作り直さない
  if (A.context && !keepAudio) resetAudioEngine();
  else startAudio();
  resetRace();
  startCountdown(performance.now());
}
