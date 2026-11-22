// @ts-check
// レース進行（カウントダウン・ライバルAI・コースギミック・接触・ゴースト・2Dオーバーレイ・毎フレームの更新）
// ※ ファイルは index.html に書いた順に読み込まれ、変数や関数はファイル間で共有される
// ===== スタートのカウントダウン（3・2・1・GO） =====
function startCountdown(now) {
  countdown.active = true;
  countdown.startAt = now;
  countdown.step = -1;
  countdown.gasPressedAt = null;
  tilt.needsCalibration = true;   // スタート前の持ち方を「まっすぐ」とする
}
function updateCountdown(now) {
  const elapsed = now - countdown.startAt;
  const step = Math.floor(elapsed / 1000);
  if (step !== countdown.step && step < 3) {
    countdown.step = step;
    showBanner(String(3 - step), 'count', 850);
    playCue('count');
  }
  if (elapsed < 3000) return;
  countdown.active = false;
  raceStarted = true;
  raceStartedAt = now;
  lapStartedAt = now;
  playCue('go');
  hintSeen = true;
  if (tilt.active && !tilt.supported) showToast('傾きセンサーの値が届いていません。⚙設定で「ボタン」に切り替えてください', 'bad', 3000);
  // GOの0.5秒前〜直前にアクセルを踏み込むとロケットスタート、早すぎるとエンスト
  const goAt = countdown.startAt + 3000;
  const launchHeld = raceOptions.autoAccel ? keys.boost : keys.gas;
  if (launchHeld && countdown.gasPressedAt !== null) {
    const early = goAt - countdown.gasPressedAt;
    if (early <= 500) {
      car.speed = 13;
      car.dashTimer = 70;
      showBanner('GO!', 'go', 900);
      showToast('ROCKET START!', 'good', 1400);
      playCue('dash');
      return;
    }
    if (early > 1300 && !raceOptions.autoAccel) {
      car.stallTimer = 50;
      showBanner('GO!', 'go', 900);
      showToast('エンスト… 踏むのが早すぎ', 'bad', 1400);
      return;
    }
  }
  showBanner('GO!', 'go', 900);
}

function spawnSparks(x, y, count) {
  for (let i = 0; i < count; i++) {
    car.sparks.push({
      x, y,
      vx: (Math.random() - 0.5) * 8,
      vy: -Math.random() * 5 - 1,
      life: 14 + Math.random() * 10
    });
  }
}
function updateSparks(dt) {
  car.sparks.forEach(spark => {
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.vy += 0.35 * dt;
    spark.life -= dt;
  });
  car.sparks = car.sparks.filter(spark => spark.life > 0);
}

// ===== ライバルAI =====
function updateRacers(dt, now) {
  if (!raceStarted) return;
  const laneOptions = [-0.74, -0.5, -0.25, 0, 0.25, 0.5, 0.74];
  const playerLaneForRival = car.x * PLAYER_LANE_SCALE / RIVAL_LANE_SCALE;
  const pitZone = TRACK_ZONES.find(zone => zone.type === 'pit');
  racers.forEach(racer => {
    if (racer.status !== 'racing') return;
    const finished = racer.dist >= TOTAL_DISTANCE;
    if (finished && !racer.finishAt) racer.finishAt = now;
    const progress = clamp(racer.dist / TOTAL_DISTANCE, 0, 1);
    const ahead = racer.dist - car.dist;
    // PIT: エネルギーが減ったライバルはピットレーンに寄せて回復する（ピットで競り合いになる）
    const racerProg = lapProgress(racer.dist);
    const inPit = Boolean(pitZone) && racerProg >= pitZone.start && racerProg < pitZone.end;
    const toPit = pitZone ? (pitZone.start - racerProg + LAP_DISTANCE) % LAP_DISTANCE : Infinity;
    const wantsPit = Boolean(pitZone) && racer.energy < 65 && !finished && (toPit < 1400 || inPit);

    // 進路: ピットへ向かうライバルが最優先。ブロッカーは後ろに迫る自機の前へ入る
    racer.laneChangeTimer -= dt;
    if (wantsPit) {
      racer.targetLane = clamp(pitZone.lane / RIVAL_LANE_SCALE, -0.78, 0.78);
    } else if (racer.style === 'blocker' && ahead > 0 && ahead < 260 && car.status === 'racing') {
      racer.targetLane = clamp(playerLaneForRival, -0.78, 0.78);
    } else if (racer.laneChangeTimer <= 0) {
      const candidates = laneOptions.filter(lane => Math.abs(lane - racer.lane) > 0.22);
      racer.targetLane = candidates[Math.floor(Math.random() * candidates.length)];
      racer.laneChangeTimer = 90 + Math.random() * 150;
    }

    // 速度: 実力 + 性格 + 追い上げ/手加減（ラバーバンド）
    let target = 14.4 * racer.skill * (course.difficulty || 1) * raceOptions.difficulty;
    if (racer.style === 'runner') target += 0.9 * (1 - progress);
    if (racer.style === 'closer') target += 1.4 * progress - 0.5;
    if (car.status === 'racing') {
      const behindPlayer = car.dist - racer.dist;
      if (behindPlayer > 0) target += clamp(behindPlayer / 900, 0, 1) * 2.6;
      else target -= clamp(-behindPlayer / 2400, 0, 1) * 1.3;
    }
    racer.boost = Math.min(100, racer.boost + 0.16 * dt);
    if (racer.boostTimer > 0) {
      racer.boostTimer -= dt;
      target += 6;
    } else if (racer.boost > 60 && Math.random() < (progress > 0.66 ? 0.012 : 0.004) * dt) {
      racer.boostTimer = 75;
      racer.boost -= 45;
    }
    if (zoneAt(racer.dist, 'dash')) target += 3;
    if (inPit && Math.abs(racer.lane * RIVAL_LANE_SCALE - pitZone.lane) < pitZone.width / 2) {
      racer.energy = Math.min(100, racer.energy + 0.45 * dt);
      target -= 1.2;
    }
    if (finished) target = Math.min(target, 12);

    racer.speed += (target - racer.speed) * (1 - Math.pow(0.985, dt));
    racer.lane += (racer.targetLane - racer.lane) * (1 - Math.pow(wantsPit ? 0.95 : 0.985, dt));
    racer.dist += racer.speed * dt;
    racer.energy = Math.min(100, racer.energy + 0.004 * dt);
  });
}

// ===== 自機とコースギミック =====
const ZONE_WARNINGS = {
  jump: '⚠ JUMP', slip: '⚠ ICE  グリップ低下', rough: '⚠ ROUGH ZONE  ダメージ注意',
  pit: 'PIT ▶ エネルギー回復', dash: 'DASH ZONE ▶', norail: '⚠ NO GUARDRAIL  落下注意'
};
// ===== コースアウト（落下）と復帰 =====
function railOpenAt(distance, side) {
  const prog = lapProgress(distance);
  return TRACK_ZONES.some(zone => zone.type === 'norail' && prog >= zone.start && prog < zone.end
    && (zone.side === 0 || zone.side === side));
}
function startFall(now) {
  car.fallTimer = FALL_FRAMES;
  car.fallDepth = 0;
  car.fallVel = 0.3;
  car.fallSpin = 0;
  car.fallDir = Math.sign(car.x) || 1;
  car.fallDist = car.dist;
  car.driftBonus = 0;
  car.driftCombo = 0;
  car.shake = 6;
  releaseAllInputs();
  showBanner('COURSE OUT', 'bad', 1300);
  playCue('fall');
}
// 復帰: コース中央に戻し、しばらく半透明（無敵）で走らせる
function respawnPlayer() {
  let s = car.fallDist;
  const jump = zoneAt(s, 'jump');
  if (jump) s = Math.floor(s / LAP_DISTANCE) * LAP_DISTANCE + jump.end + 20;   // ジャンプ中の落下は着地点へ
  car.dist = Math.max(car.dist, s);
  car.x = 0;
  car.slide = 0;
  car.tilt = 0;
  car.speed = 6;
  car.air = false;
  car.fallTimer = 0;
  car.fallDepth = 0;
  car.respawnTimer = RESPAWN_FRAMES;
  car.energy = Math.max(1, car.energy - 12);
  car.collisionCooldown = RESPAWN_FRAMES;
  showToast('RECOVERY', 'good', 1400);
  playCue('respawn');
}
// 自機の不透明度（復帰直後は点滅しながら徐々に実体化）
function playerOpacity(now) {
  if (car.respawnTimer <= 0) return 1;
  const t = 1 - car.respawnTimer / RESPAWN_FRAMES;
  const blink = Math.sin(now * 0.025) * 0.12;
  return clamp(0.28 + t * t * 0.55 + blink, 0.15, 0.95);
}
function applyTrackZones(dt, now, m) {
  const lapIndex = Math.floor(car.dist / LAP_DISTANCE);
  const prog = lapProgress(car.dist);
  const playerLane = car.x * PLAYER_LANE_SCALE;
  car.onSlip = false;
  car.onRough = false;
  if (car.air) return;
  TRACK_ZONES.forEach((zone, zoneIndex) => {
    if (prog < zone.start || prog >= zone.end) return;
    const inBand = zone.width > 1 || Math.abs(playerLane - zone.lane) < zone.width / 2;
    if (!inBand) return;
    const key = `${lapIndex}:${zoneIndex}`;
    const first = !zoneHits.has(key);
    zoneHits.add(key);
    if (zone.type === 'dash' && first) {
      car.boost = Math.min(100, car.boost + 18);
      car.speed = Math.min(27, car.speed + 3.4);
      car.dashTimer = 90;
      car.shake = Math.max(car.shake, 1.5);
      playCue('dash');
    }
    if (zone.type === 'pit') {
      // スピードを落とすほど速く回復（ブーストで駆け抜けると回復は少ない）。ボディ強化で回復量アップ
      const pitSpeed = 0.6 + 0.8 * clamp((20 - car.speed) / 10, 0, 1);
      car.energy = Math.min(100, car.energy + 0.5 * m.pitRate * pitSpeed * dt);
      if (first && car.energy < 90) showToast('PIT — 減速するほど速く回復', 'good', 1500);
      car.overload = 0;
      car.boost = Math.min(100, car.boost + 0.15 * dt);
      car.pitTimer -= dt;
      if (car.pitTimer <= 0 && car.energy < 100) {
        car.pitTimer = 9;
        playCue('charge');
      }
      if (first) playCue('pit');
    }
    if (zone.type === 'slip') car.onSlip = true;
    if (zone.type === 'rough') {
      car.onRough = true;
      car.speed *= Math.pow(0.988, dt);
      applyDamage(0.04 * m.damage * dt, now, 'rough');
      car.shake = Math.max(car.shake, 1.2);
      if (Math.random() < 0.3 * dt) spawnSparks(W / 2 + (Math.random() - 0.5) * 80, H - 66, 1);
    }
  });
  // 地雷
  course.mines.forEach((mine, mineIndex) => {
    const key = `${lapIndex}:${mineIndex}`;
    if (mineHits.has(key) || car.status !== 'racing' || car.respawnTimer > 0) return;
    if (Math.abs(prog - mine.s) < 16 && Math.abs(playerLane - mine.lane) < 0.07) {
      mineHits.add(key);
      addExplosion(lapIndex * LAP_DISTANCE + mine.s, mine.lane, false);
      car.speed *= 1 - 0.35 * m.impact;
      car.slide += (Math.random() - 0.5) * 0.2;
      car.shake = 10;
      spawnSparks(W / 2, H - 80, 10);
      playCue('mine');
      breakCombo('地雷');
      applyDamage(9 * m.damage * (0.6 + car.speed / 20), now, 'mine');
    }
  });
}

// ドリドリのコンボが途切れる（3コンボ以上なら加速の上乗せの大半を失う）
function breakCombo(reason) {
  if (car.driftCombo >= 3) {
    car.driftBonus *= 0.35;
    showToast(`COMBO BREAK ×${car.driftCombo}（${reason}）`, 'bad', 1100);
    playCue('break');
  }
  car.driftCombo = 0;
}
// 接触: 両者のエネルギーが削れる。速度差が大きいほど痛い。重いマシンほど押し勝つ
function checkRivalContact(now, m) {
  if (car.collisionCooldown > 0 || car.air || car.respawnTimer > 0) return;
  const playerLane = car.x * PLAYER_LANE_SCALE;
  for (const racer of racers) {
    if (racer.status !== 'racing' || airHeightAt(racer.dist) > 1) continue;
    const gap = racer.dist - car.dist;
    if (Math.abs(gap) > 30) continue;
    const rivalLane = racer.lane * RIVAL_LANE_SCALE;
    if (Math.abs(rivalLane - playerLane) > 0.16) continue;
    const relative = Math.abs(car.speed - racer.speed);
    const force = 0.6 + car.speed / 20 + relative / 10;
    const push = playerLane <= rivalLane ? 1 : -1;
    // 体当たり（サイドアタック）: 横に並んだ相手へハンドルを切りながら当たると、
    // 相手に大ダメージ＋大きく押し出し、自分は軽いダメージで済む。漫然と追突すると自分が損をする
    const attacking = Math.abs(gap) < 22 && (car.steerAxis * push > 0.3 || car.slide * push > 0.004);
    car.collisionCooldown = 40;
    racer.energy -= (14 * force * (attacking ? 1.7 : 1)) / m.impact;
    if (gap >= 0) {
      car.speed *= 1 - (attacking ? 0.08 : 0.22) * m.impact;
      racer.speed += attacking ? 0.4 : 1.5;
      racer.dist = Math.max(racer.dist, car.dist + 32);
    } else {
      car.speed += 0.8;
      racer.speed *= 0.8;
      racer.dist = Math.min(racer.dist, car.dist - 32);
    }
    car.slide -= push * (attacking ? 0.05 : 0.1);
    racer.lane = clamp(racer.lane + push * (attacking ? 0.24 : 0.12), -0.8, 0.8);
    racer.targetLane = clamp(racer.lane + push * 0.3, -0.78, 0.78);
    car.shake = attacking ? 10 : 8;
    spawnSparks(W / 2 + push * 20, H - 83, attacking ? 12 : 7);
    breakCombo('接触');
    playCue(attacking ? 'attack' : 'contact');
    if (racer.energy <= 0) {
      knockOut(racer);
    } else if (attacking) {
      car.attackCount++;
      showToast(`SIDE ATTACK!  ${racer.name} ENERGY ${Math.round(racer.energy)}%`, 'ko', 1100);
    }
    applyDamage(5 * m.damage * Math.min(force, 1.8) * (attacking ? 0.55 : 1), now, 'contact');
    break;
  }
}

// ===== ゴースト（タイムアタック） =====
function recordGhost(now) {
  if (raceMode !== 'ta' || !raceStarted) return;
  const elapsed = now - raceStartedAt;
  while (ghostRecord.length * GHOST_INTERVAL <= elapsed) {
    ghostRecord.push([Math.round(car.dist * 10) / 10, Math.round(car.x * 1000) / 1000]);
  }
}
function updateGhost(now) {
  ghostState.visible = false;
  if (raceMode !== 'ta' || selectingMachine || !ghostData || !ghostData.samples.length) return;
  const samples = ghostData.samples;
  const elapsed = raceStarted ? now - raceStartedAt : 0;
  const f = elapsed / GHOST_INTERVAL;
  if (f > samples.length + 10) return;
  const i = Math.min(Math.floor(f), samples.length - 1);
  const j = Math.min(i + 1, samples.length - 1);
  const k = clamp(f - Math.floor(f), 0, 1);
  ghostState.dist = samples[i][0] + (samples[j][0] - samples[i][0]) * k;
  ghostState.x = samples[i][1] + (samples[j][1] - samples[i][1]) * k;
  ghostState.visible = true;
}

// ===== 花火（ゴール演出） =====
function spawnFirework() {
  const x = W * 0.15 + Math.random() * W * 0.7;
  const y = 50 + Math.random() * 130;
  const hue = Math.floor(Math.random() * 360);
  for (let i = 0; i < 46; i++) {
    const angle = Math.random() * Math.PI * 2;
    const velocity = 1.2 + Math.random() * 2.6;
    fireworks.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life: 50 + Math.random() * 30, hue });
  }
}
function updateFireworks(dt, now) {
  if (car.status === 'finished' && now - finishAt < 7000 && Math.random() < 0.05 * dt) spawnFirework();
  let write = 0;
  for (const p of fireworks) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 0.03 * dt;
    p.vx *= Math.pow(0.985, dt);
    p.life -= dt;
    if (p.life > 0) fireworks[write++] = p;
  }
  fireworks.length = write;
}
function drawFireworks() {
  if (!fireworks.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  fireworks.forEach(p => {
    ctx.fillStyle = `hsla(${p.hue}, 95%, 65%, ${clamp(p.life / 50, 0, 1)})`;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  });
  ctx.restore();
}

// ===== ミニマップ・進行バー・警告（2Dオーバーレイ） =====
const MINIMAP_N = 240;
const minimap = { points: [], x: 690, y: 92, w: 100, h: 84 };
// コースの曲がり具合から周回コースの形を積分して作り、始点と終点がつながるよう補正する
// 戻り値は (0,0)〜(w,h) の箱に収めた点列（描画時に位置をずらす）
function computeMapPoints(courseDef, w, h, pad) {
  const raw = [];
  let x = 0, y = 0;
  const lap = courseDef.lap;
  const step = lap / MINIMAP_N;
  for (let i = 0; i <= MINIMAP_N; i++) {
    raw.push([x, y]);
    const s = i * step;
    const slope = (waveOf(courseDef.curve, lap, s + 40) - waveOf(courseDef.curve, lap, s - 40)) / 80;
    const heading = (i / MINIMAP_N) * Math.PI * 2 + slope * 3.2 - Math.PI / 2;
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
  }
  const [endX, endY] = raw[MINIMAP_N];
  raw.forEach((point, i) => {
    point[0] -= endX * i / MINIMAP_N;
    point[1] -= endY * i / MINIMAP_N;
  });
  const xs = raw.map(p => p[0]), ys = raw.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxY - minY));
  const offX = (w - (maxX - minX) * scale) / 2;
  const offY = (h - (maxY - minY) * scale) / 2;
  return raw.map(([px, py]) => [offX + (px - minX) * scale, offY + (py - minY) * scale]);
}
function buildMinimap() {
  minimap.points = computeMapPoints(course, minimap.w, minimap.h, 8);
}
function mapPoint(distance) {
  const f = lapProgress(distance) / LAP_DISTANCE * MINIMAP_N;
  const i = Math.floor(f), t = f - i;
  const a = minimap.points[i], b = minimap.points[Math.min(i + 1, MINIMAP_N)];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function strokeMapRange(start, end, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let s = start; s <= end; s += LAP_DISTANCE / MINIMAP_N) {
    const [px, py] = mapPoint(s);
    if (s === start) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}
function drawMinimap(now) {
  if (!minimap.points.length) return;
  // 画面の右端（右上パネルの下）に置く。点列は箱の左上を原点にした座標
  minimap.x = W - minimap.w - 10;
  const { x, y, w, h } = minimap;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(7, 18, 42, 0.62)';
  ctx.strokeStyle = 'rgba(103, 232, 249, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(0, 0, w, h, 7) : ctx.rect(0, 0, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.lineJoin = 'round';
  ctx.shadowColor = course.accent;
  ctx.shadowBlur = 6;
  strokeMapRange(0, LAP_DISTANCE, 'rgba(226, 232, 240, 0.85)', 2.2);
  ctx.shadowBlur = 0;
  TRACK_ZONES.forEach(zone => strokeMapRange(zone.start, zone.end, zone.color, 3));
  course.mines.forEach(mine => {
    const [mx, my] = mapPoint(mine.s);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(mx - 1, my - 1, 2, 2);
  });
  const [sx, sy] = mapPoint(0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(sx - 3, sy - 1, 6, 2);
  racers.forEach(racer => {
    if (racer.status !== 'racing') return;
    const [rx, ry] = mapPoint(racer.dist);
    ctx.fillStyle = racer.color;
    ctx.beginPath();
    ctx.arc(rx, ry, 2.1, 0, Math.PI * 2);
    ctx.fill();
  });
  if (ghostState.visible) {
    const [gx, gy] = mapPoint(ghostState.dist);
    ctx.fillStyle = 'rgba(186, 230, 253, 0.7)';
    ctx.beginPath();
    ctx.arc(gx, gy, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const [px, py] = mapPoint(car.dist);
  const pulse = 3.4 + Math.sin(now * 0.012) * 0.8;
  ctx.fillStyle = '#fde047';
  ctx.shadowColor = '#fde047';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(px, py, pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function drawProgressBar() {
  const w = 300, x = W / 2 - w / 2, y = 16;
  const toX = distance => x + lapProgress(distance) / LAP_DISTANCE * w;
  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  ctx.fillRect(x, y - 2, w, 4);
  TRACK_ZONES.forEach(zone => {
    ctx.fillStyle = zone.color;
    ctx.fillRect(x + zone.start / LAP_DISTANCE * w, y - 2, (zone.end - zone.start) / LAP_DISTANCE * w, 4);
  });
  racers.forEach(racer => {
    if (racer.status !== 'racing') return;
    ctx.fillStyle = racer.color;
    ctx.fillRect(toX(racer.dist) - 1, y - 5, 2, 10);
  });
  if (ghostState.visible) {
    ctx.fillStyle = 'rgba(186, 230, 253, 0.8)';
    ctx.fillRect(toX(ghostState.dist) - 1, y - 6, 2, 12);
  }
  const px = car.status === 'finished' ? x + w : toX(car.dist);
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.moveTo(px, y + 4);
  ctx.lineTo(px - 5, y + 12);
  ctx.lineTo(px + 5, y + 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + w - 1, y - 6, 2, 12);
  ctx.restore();
}
function drawWarnings(now) {
  const lines = [];
  const turn = curveCenterAt(car.dist + 900) - curveCenterAt(car.dist + 250);
  if (Math.abs(turn) >= 80) lines.push([turn > 0 ? '急カーブ ▶▶' : '◀◀ 急カーブ', '#fb7185']);
  else if (Math.abs(turn) >= 38) lines.push([turn > 0 ? 'RIGHT TURN ›' : '‹ LEFT TURN', '#f8fafc']);
  const prog = lapProgress(car.dist);
  for (const zone of TRACK_ZONES) {
    const ahead = (zone.start - prog + LAP_DISTANCE) % LAP_DISTANCE;
    if (ahead > 0 && ahead < 900 && ZONE_WARNINGS[zone.type]) {
      lines.push([ZONE_WARNINGS[zone.type], zone.color]);
      break;
    }
  }
  if (course.mines.some(mine => {
    const ahead = (mine.s - prog + LAP_DISTANCE) % LAP_DISTANCE;
    return ahead > 0 && ahead < 900;
  })) lines.push(['⚠ MINES  地雷に注意', '#f87171']);
  if (car.energy < 25 && Math.floor(now / 250) % 2 === 0) lines.push(['DANGER!  ENERGY LOW', '#f87171']);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 11px sans-serif';
  ctx.textBaseline = 'middle';
  // 進行バーのすぐ下に、小さな帯で最大2件だけ表示（コースの見通しを邪魔しない）
  lines.slice(0, 2).forEach(([text, color], i) => {
    const y = 42 + i * 17;
    const width = ctx.measureText(text).width + 18;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.62)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(W / 2 - width / 2, y - 7.5, width, 15, 7.5);
    else ctx.rect(W / 2 - width / 2, y - 7.5, width, 15);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, W / 2, y + 0.5);
  });
  ctx.restore();
}
// 接近中のライバル（真横〜後方で画面に映りにくい相手）を画面の左右の端に表示する
// 名前・エネルギー残量を出し、残りが少ない相手は「K.O.」で体当たりのチャンスを知らせる
function drawRivalRadar() {
  const playerLane = car.x * PLAYER_LANE_SCALE;
  const near = racers
    .filter(racer => racer.status === 'racing' && racer.dist - car.dist < 40 && racer.dist - car.dist > -220)
    .sort((a, b) => Math.abs(a.dist - car.dist) - Math.abs(b.dist - car.dist))
    .slice(0, 3);
  if (!near.length) return;
  ctx.save();
  ctx.font = 'bold 10px sans-serif';
  ctx.textBaseline = 'middle';
  const slots = { '-1': 0, '1': 0 };
  near.forEach(racer => {
    const side = racer.lane * RIVAL_LANE_SCALE >= playerLane ? 1 : -1;
    const closeness = 1 - Math.abs(racer.dist - car.dist) / 220;
    const w = 78, h = 22;
    const x = side > 0 ? W - 8 - w : 8;
    const y = H * 0.5 + slots[side]++ * (h + 4);
    const weak = racer.energy < 35;
    ctx.globalAlpha = 0.4 + closeness * 0.6;
    ctx.fillStyle = 'rgba(2, 6, 23, 0.68)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6); else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.strokeStyle = weak ? '#fb923c' : racer.color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = racer.color;
    ctx.textAlign = side > 0 ? 'right' : 'left';
    ctx.fillText(side > 0 ? '▶' : '◀', side > 0 ? x + w - 4 : x + 4, y + 8);
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.fillText(weak ? `${racer.name} K.O.!` : racer.name, x + w / 2, y + 8);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.3)';
    ctx.fillRect(x + 6, y + 15, w - 12, 3);
    ctx.fillStyle = weak ? '#f87171' : '#4ade80';
    ctx.fillRect(x + 6, y + 15, (w - 12) * clamp(racer.energy / 100, 0, 1), 3);
  });
  ctx.restore();
}
function drawRaceOverlay2D(now) {
  if (selectingMachine) return;
  // ダメージを受けた瞬間と、エネルギー0（DANGER）の間は画面の縁が赤く光る
  const danger = car.status === 'racing' && raceStarted && car.energy <= 0 ? 0.35 + Math.sin(now * 0.02) * 0.2 : 0;
  const red = Math.max(car.damageFlash * 0.7, danger);
  if (red > 0.01) {
    const glow = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
    glow.addColorStop(0, 'rgba(220, 38, 38, 0)');
    glow.addColorStop(1, `rgba(220, 38, 38, ${red})`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }
  if (car.status === 'racing' && raceStarted) drawWarnings(now);
  if (car.status === 'racing' && raceStarted && raceMode !== 'ta') drawRivalRadar();
  drawProgressBar();
  drawMinimap(now);
  drawFireworks();
}

function updateMeters(canBoost, drifting) {
  const spdText = document.getElementById('spdText');
  spdText.textContent = `${Math.round(car.speed * 22)} KM/H`;
  spdText.classList.toggle('over', car.driftBonus > 0.5 && car.speed > 15.2);
  const driftText = document.getElementById('driftText');
  driftText.textContent = car.driftCombo > 0
    ? `DORI-DORI ×${car.driftCombo}  +${Math.round(car.driftBonus * 22)}`
    : (drifting ? 'DRIFT' : (car.onSlip ? 'ICE!' : ''));
  driftText.classList.toggle('good', car.driftCombo >= 3);
  driftText.classList.toggle('tier', car.doriFlash > 0);
  document.getElementById('bstText').textContent = `BOOST: ${Math.floor(car.boost)}%${canBoost ? ' [ACTIVE!]' : ''}`;
  boostFill.style.width = `${car.boost}%`;
}

// ===== メイン更新 =====
function update(dt, now) {
  updateFireworks(dt, now);
  syncMusic(now);
  if (selectingMachine) {
    car.speed = 0;
    updateEngineAudio(false);
    updateRaceHud(now);
    return;
  }
  if (resultsAt !== null && now >= resultsAt) {
    resultsAt = null;
    showResults();
  }
  updateSparks(dt);
  updateGhost(now);

  // ゴール後・リタイア後: 自動走行で流しつつライバルも走り続ける
  if (car.status !== 'racing') {
    if (car.status === 'finished') {
      car.speed += (13 - car.speed) * (1 - Math.pow(0.97, dt));
      car.x *= Math.pow(0.985, dt);
      car.tilt *= Math.pow(0.9, dt);
      car.driftBonus = 0;
      car.driftCombo = 0;
    } else {
      car.speed *= Math.pow(0.93, dt);
    }
    car.dist += car.speed * dt;
    updateRacers(dt, now);
    car.shake = Math.max(0, car.shake - 0.35 * dt);
    updateEngineAudio(false);
    updateMeters(false, false);
    updateRaceHud(now);
    return;
  }

  if (countdown.active) {
    updateCountdown(now);
    updateEngineAudio(false);
    updateMeters(false, false);
    updateRaceHud(now);
    if (countdown.active) return;
  }

  // 落下中: 操作不能。コース外へ流れながら落ち、時間が来たら復帰
  if (car.fallTimer > 0) {
    car.fallTimer -= dt;
    car.fallVel += 0.09 * dt;
    car.fallDepth += car.fallVel * dt;
    car.fallSpin += 0.06 * dt * car.fallDir;
    car.x += car.fallDir * 0.006 * dt;
    car.speed *= Math.pow(0.96, dt);
    car.shake = Math.max(0, car.shake - 0.35 * dt);
    updateRacers(dt, now);
    updateEngineAudio(false);
    updateMeters(false, false);
    if (car.fallTimer <= 0) respawnPlayer();
    updateRaceHud(now);
    return;
  }
  car.respawnTimer = Math.max(0, car.respawnTimer - dt);
  car.damageFlash = Math.max(0, car.damageFlash - 0.04 * dt);
  car.doriFlash = Math.max(0, car.doriFlash - dt);
  // エネルギー低下の警告音（0になると速く鳴る）
  if (car.energy < 25) {
    car.alarmTimer -= dt;
    if (car.alarmTimer <= 0) {
      car.alarmTimer = car.energy <= 0 ? 16 : 40;
      playCue('alarm');
    }
  }

  const m = effectiveMachine();
  car.stallTimer = Math.max(0, car.stallTimer - dt);
  const stalled = car.stallTimer > 0;
  // オートアクセル中は常に加速し、GOボタン（Zキー）はブレーキになる
  const braking = raceOptions.autoAccel && keys.gas;
  const gasOn = (raceOptions.autoAccel ? !keys.gas : keys.gas) && !stalled;
  const wasBoosting = car.wasBoosting;
  const canBoost = keys.boost && car.boost > 5 && car.energy > 0 && !stalled;
  const energyLimit = car.energy > 0 ? 1 : 0.62;
  // ハンドル: ボタン/キーは -1・0・1、傾き操作はその間の連続値（ボタンが押されていればボタン優先）
  const digitalSteer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  // 傾き操作はボタンより曲がりが弱く感じやすいので 1.5倍に強めて使う（最大はボタンと同じ）
  const steer = digitalSteer !== 0 || !tilt.active ? digitalSteer : clamp(tilt.value * 1.5, -1, 1);
  car.steerAxis = steer;
  // ドリドリの切り返し判定は「どちらに切っているか」だけを見る
  const steerDir = Math.abs(steer) > 0.35 ? Math.sign(steer) : 0;

  // ジャンプ
  const air = airHeightAt(car.dist) > 0.6;
  if (air && !car.air) playCue('jump');
  if (!air && car.air) {
    car.air = false;
    // ガードレールの外に着地したらコースアウト
    if (Math.abs(car.x) > 1.0 && car.respawnTimer <= 0) {
      startFall(now);
      updateRaceHud(now);
      return;
    }
    car.x = clamp(car.x, -0.95, 0.95);
    car.shake = Math.max(car.shake, 4);
    playCue('land');
    spawnSparks(W / 2 - 40, H - 66, 5);
    spawnSparks(W / 2 + 40, H - 66, 5);
  }
  car.air = air;
  const drifting = keys.drift && (gasOn || canBoost) && car.speed > 6 && !air;
  car.drifting = drifting;
  car.scraping = !air && Math.abs(car.x) > 0.92 && !railOpenAt(car.dist, Math.sign(car.x));

  // ドリドリ判定: ドリフト中に左右を切り返したタイミングを評価
  car.sinceSwitch += dt;
  if (steerDir !== 0 && steerDir !== car.lastSteerDir) {
    const interval = car.sinceSwitch;
    if (drifting && car.lastSteerDir !== 0 && interval >= DORI_MIN_INTERVAL && interval <= m.doriWindow) {
      car.driftBonus = Math.min(DORI_MAX_BONUS * m.dori, car.driftBonus + DORI_GAIN * m.dori);
      car.driftCombo++;
      car.maxCombo = Math.max(car.maxCombo, car.driftCombo);
      spawnSparks(W / 2 + (steerDir > 0 ? -48 : 48), H - 70, 4);
      playCue('drift');
      // 5コンボごとにブーストが戻り、一瞬ダッシュする（つなぐほど還元が大きい）
      if (car.driftCombo % 5 === 0) {
        const tier = car.driftCombo / 5;
        const refund = Math.min(30, 10 + tier * 4);
        car.boost = Math.min(100, car.boost + refund);
        car.dashTimer = Math.max(car.dashTimer, 35);
        car.speed += 0.8;
        car.doriFlash = 40;
        showToast(`DORI-DORI ×${car.driftCombo}  BOOST +${refund}`, 'good', 1100);
        playCue('comboTier');
      }
    } else if (drifting && interval < DORI_MIN_INTERVAL) {
      car.driftCombo = 0; // 速すぎる連打はロス
      car.driftBonus = Math.max(0, car.driftBonus - 0.4);
    }
    car.lastSteerDir = steerDir;
    car.sinceSwitch = 0;
  }
  if (!drifting) {
    car.driftBonus *= Math.pow(0.97, dt);
    car.driftCombo = 0;
    if (!keys.drift) car.lastSteerDir = 0;
  } else if (car.sinceSwitch > m.doriWindow) {
    // 切り返しが止まると徐々にボーナスが抜け、ドリフト抵抗で減速
    car.driftBonus *= Math.pow(0.985, dt);
    car.driftCombo = 0;
    car.speed *= Math.pow(0.998, dt);
  }
  if (car.driftBonus < 0.02) car.driftBonus = 0;

  const maxSpeed = (canBoost ? 24 * m.boostTop : (gasOn ? 15 * m.top : 4)) * energyLimit
    + (car.dashTimer > 0 ? 2 : 0)
    + car.driftBonus * energyLimit;

  if (canBoost) {
    car.speed += (maxSpeed - car.speed) * (1 - Math.pow(1 - 0.14 * m.accel, dt));
    car.boost = Math.max(0, car.boost - 1.4 * m.boostDrain * dt);
  } else if (gasOn) {
    car.speed += (maxSpeed - car.speed) * (1 - Math.pow(1 - 0.06 * m.accel, dt));
    car.boost = Math.min(100, car.boost + 0.25 * dt);
  } else {
    car.speed *= Math.pow(braking ? 0.94 : 0.97, dt);
    car.boost = Math.min(100, car.boost + 0.4 * dt);
  }
  car.dashTimer = Math.max(0, car.dashTimer - dt);
  car.wasBoosting = canBoost;
  if (canBoost && !wasBoosting) playCue('boost');

  // 操舵: 空中では効きが弱く、氷の上ではグリップが落ちて流れる
  const grip = (air ? 0.3 : 1) * (car.onSlip ? 0.55 : 1);
  car.tilt += (steer - car.tilt) * (1 - Math.pow(0.84, dt));
  car.slide += steer * (0.00012 + car.speed * 0.00001) * (drifting ? 1.6 : 1) * m.steer * grip * dt;
  car.slide *= Math.pow(car.onSlip ? (steer ? 0.985 : 0.975) : (steer ? 0.94 : 0.82), dt);
  if (!air) {
    const curvePull = curveCenterAt(car.dist + 120) - curveCenterAt(car.dist);
    car.x -= curvePull * car.speed * 0.000012 * dt;
  }
  car.x += (car.tilt * 0.009 * m.steer * grip * (0.4 + car.speed / 24) + car.slide) * dt;
  if (air) car.x = clamp(car.x, -1.6, 1.6);   // 空中ではガードレールを越えられる
  if (car.respawnTimer > 0) car.x = clamp(car.x, -0.9, 0.9);   // 復帰直後は落ちない

  car.dist += car.speed * dt;
  updateRacers(dt, now);
  // ガードレールのない区間で外へ出ると落下
  if (!air && Math.abs(car.x) > 0.97 && railOpenAt(car.dist, Math.sign(car.x))) {
    startFall(now);
    updateRaceHud(now);
    return;
  }
  if (!air && Math.abs(car.x) > 0.92 && !railOpenAt(car.dist, Math.sign(car.x))) {
    car.speed *= Math.pow(0.94, dt);
    if (car.driftCombo > 0) breakCombo('壁');
    applyDamage(0.03 * m.damage * (0.5 + car.speed / 15) * dt, now, 'wall');
    car.slide -= Math.sign(car.x) * 0.003 * dt;
    if (Math.random() < 0.38 * dt) {
      spawnSparks(W / 2 + (car.x > 0 ? 55 : -55), H - 72, 2);
    }
  }

  car.collisionCooldown = Math.max(0, car.collisionCooldown - dt);
  car.shake = Math.max(0, car.shake - 0.35 * dt);
  applyTrackZones(dt, now, m);
  checkRivalContact(now, m);
  if (drifting && Math.random() < 0.25 * dt) {
    spawnSparks(W / 2 + (Math.random() < 0.5 ? -40 : 40), H - 68, 1);
  }
  updateMeters(canBoost, drifting);
  if (car.status !== 'racing') {
    updateRaceHud(now);
    return;
  }
  recordGhost(now);

  const crossedLaps = Math.floor(car.dist / LAP_DISTANCE);
  while (completedLaps < Math.min(crossedLaps, TOTAL_LAPS)) {
    completedLaps++;
    const lapTime = now - lapStartedAt;
    lapTimes.push(lapTime);
    lapStartedAt = now;
    if (completedLaps < TOTAL_LAPS) {
      const isBest = completedLaps > 1 && lapTime <= Math.min(...lapTimes);
      car.boost = Math.min(100, car.boost + 8);
      showToast(`LAP ${completedLaps}  ${formatTime(lapTime)}${isBest ? '  BEST!' : ''}`, isBest ? 'good' : '', 1800);
      if (completedLaps === TOTAL_LAPS - 1) {
        showBanner('FINAL LAP', 'final', 1900);
        playCue('final');
      } else {
        playCue('lap');
      }
    }
  }
  if (car.dist >= TOTAL_DISTANCE) finishRace(now);

  updateEngineAudio(canBoost);
  updateRaceHud(now);
}
