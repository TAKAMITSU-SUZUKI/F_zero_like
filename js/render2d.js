// @ts-check
// 2D描画（three.js が読み込めなかったときの予備の描画）
// ※ ファイルは index.html に書いた順に読み込まれ、変数や関数はファイル間で共有される
function roadAt(depth) {
  const lookAhead = (1 - depth) * VIEW_DISTANCE;
  const curveOffset = (curveCenterAt(car.dist + lookAhead) - curveCenterAt(car.dist)) * 0.72;
  const speedRatio = clamp(car.speed / 24, 0, 1);
  return {
    centerX: W / 2 + curveOffset - car.x * 260 * depth,
    halfW: 45 + depth * (390 + speedRatio * 22)
  };
}

function drawTrackZones() {
  const progress = car.dist % LAP_DISTANCE;
  const roadHeight = H - HORIZON;
  TRACK_ZONES.forEach(zone => {
    const zoneLength = zone.end - zone.start;
    const inside = progress >= zone.start && progress < zone.end;
    const nearGap = inside ? 0 : (zone.start - progress + LAP_DISTANCE) % LAP_DISTANCE;
    const farGap = inside ? zone.end - progress : nearGap + zoneLength;
    if (nearGap > VIEW_DISTANCE) return;

    const nearDepth = 1 - nearGap / VIEW_DISTANCE;
    const farDepth = 1 - Math.min(farGap, VIEW_DISTANCE) / VIEW_DISTANCE;
    const boundsAt = depth => {
      const road = roadAt(depth);
      const center = road.centerX + zone.lane * road.halfW;
      const halfWidth = zone.width > 1 ? road.halfW * 0.92 : road.halfW * zone.width / 2;
      return { left: center - halfWidth, right: center + halfWidth };
    };
    const far = boundsAt(farDepth);
    const near = boundsAt(nearDepth);
    const color = zone.type === 'dash' ? '34, 211, 238' : '74, 222, 128';

    ctx.save();
    ctx.fillStyle = `rgba(${color}, ${inside ? 0.38 : 0.25})`;
    ctx.beginPath();
    ctx.moveTo(far.left, HORIZON + farDepth * roadHeight);
    ctx.lineTo(far.right, HORIZON + farDepth * roadHeight);
    ctx.lineTo(near.right, HORIZON + nearDepth * roadHeight);
    ctx.lineTo(near.left, HORIZON + nearDepth * roadHeight);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(${color}, 0.9)`;
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= 6; i++) {
      const depth = farDepth + (nearDepth - farDepth) * (i / 6);
      const bounds = boundsAt(depth);
      const y = HORIZON + depth * roadHeight;
      ctx.beginPath();
      ctx.moveTo(bounds.left, y);
      ctx.lineTo(bounds.right, y);
      ctx.stroke();
    }

    if (farGap < VIEW_DISTANCE) {
      const labelGap = Math.max(0, nearGap + (farGap - nearGap) * 0.75);
      const depth = 1 - labelGap / VIEW_DISTANCE;
      const bounds = boundsAt(depth);
      ctx.fillStyle = '#f8fafc';
      ctx.shadowColor = `rgb(${color})`;
      ctx.shadowBlur = 10;
      ctx.font = `bold ${Math.max(7, 9 + depth * 8)}px sans-serif`;
      ctx.textAlign = 'center';
      const labelX = zone.type === 'dash' ? bounds.left + (bounds.right - bounds.left) * 0.32 : (bounds.left + bounds.right) / 2;
      ctx.fillText(zone.label, labelX, HORIZON + depth * roadHeight - 3);
    }
    ctx.restore();
  });
}

function drawStartLine(roadHeight) {
  const progress = car.dist % LAP_DISTANCE;
  const gap = LAP_DISTANCE - progress;
  if (gap > VIEW_DISTANCE) return;
  const depth = 1 - gap / VIEW_DISTANCE;
  const road = roadAt(depth);
  const y = HORIZON + depth * roadHeight;
  const totalWidth = road.halfW * 1.82;
  const tileWidth = totalWidth / 14;
  const tileHeight = 2 + depth * 4;
  ctx.save();
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#f8fafc' : '#111827';
    ctx.fillRect(road.centerX - totalWidth / 2 + i * tileWidth, y - tileHeight / 2, tileWidth + 0.5, tileHeight);
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.shadowColor = '#e0f2fe';
  ctx.shadowBlur = 7;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(road.centerX - totalWidth / 2, y + tileHeight / 2);
  ctx.lineTo(road.centerX + totalWidth / 2, y + tileHeight / 2);
  ctx.stroke();
  ctx.restore();
}

function drawCurveHint(roadHeight) {
  const turn = curveCenterAt(car.dist + 1150) - curveCenterAt(car.dist + 380);
  if (Math.abs(turn) < 38) return;
  const depth = 0.28;
  const road = roadAt(depth);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.shadowColor = '#0f172a';
  ctx.shadowBlur = 5;
  ctx.fillText(turn > 0 ? 'RIGHT TURN  ›' : '‹  LEFT TURN', road.centerX, HORIZON + depth * roadHeight);
  ctx.restore();
}

function drawTracksideStructures(roadHeight) {
  const spacing = 720;
  const progress = car.dist % spacing;
  for (let gap = spacing - progress; gap < VIEW_DISTANCE; gap += spacing) {
    const depth = 1 - gap / VIEW_DISTANCE;
    if (depth < 0.28 || depth > 0.72) continue;

    const road = roadAt(depth);
    const y = HORIZON + Math.pow(depth, 1.25) * roadHeight;
    const width = road.halfW * 1.72;
    const height = 13 + depth * 42;
    const postWidth = 2 + depth * 4;
    const top = y - height;
    const alpha = clamp((depth - 0.24) * 5, 0, 1) * clamp((0.78 - depth) * 6, 0, 1);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1 + depth;
    ctx.strokeStyle = '#22d3ee';
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 7 + depth * 8;

    for (const side of [-1, 1]) {
      const x = road.centerX + side * width / 2;
      const post = ctx.createLinearGradient(x, top, x, y);
      post.addColorStop(0, '#e0f2fe');
      post.addColorStop(0.35, '#22d3ee');
      post.addColorStop(1, '#155e75');
      ctx.fillStyle = post;
      ctx.fillRect(x - postWidth / 2, top, postWidth, height + depth * 11);
      ctx.fillStyle = '#f0abfc';
      ctx.fillRect(x - postWidth, top + height * 0.56, postWidth * 2, Math.max(2, depth * 3));
    }

    const beam = ctx.createLinearGradient(0, top, 0, top + Math.max(3, depth * 8));
    beam.addColorStop(0, '#f8fafc');
    beam.addColorStop(0.35, '#22d3ee');
    beam.addColorStop(1, '#155e75');
    ctx.fillStyle = beam;
    ctx.fillRect(road.centerX - width / 2, top, width, Math.max(3, depth * 8));
    ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
    ctx.fillRect(road.centerX - width * 0.19, top + 2, width * 0.38, Math.max(3, depth * 7 - 2));
    ctx.fillStyle = '#cffafe';
    ctx.font = `bold ${Math.max(4, 4 + depth * 6)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('NEON CIRCUIT', road.centerX, top + Math.max(5, depth * 7));
    ctx.restore();
  }
}

function drawSpeedLines(roadHeight) {
  const intensity = keys.boost ? 1 : clamp((car.speed - 12) / 12, 0, 0.72);
  if (intensity <= 0) return;
  ctx.save();
  ctx.globalAlpha = 0.1 + intensity * 0.23;
  ctx.strokeStyle = keys.boost ? '#bae6fd' : '#cbd5e1';
  ctx.lineWidth = 1 + intensity * 0.65;
  for (let i = 0; i < 32; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const edgeOffset = (i * 43 + car.dist * (1.7 + intensity * 3.2)) % 175;
    const x = side < 0 ? edgeOffset : W - edgeOffset;
    const y = HORIZON + ((i * 67 + car.dist * (2.2 + intensity * 4)) % roadHeight);
    const length = 8 + intensity * (18 + (i % 5) * 5);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - side * length * 0.32, y + length);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRacer(x, y, scale, color, hero) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(hero ? car.tilt * 0.05 : 0);
  ctx.scale(scale * (hero ? 1 - Math.abs(car.tilt) * 0.035 : 1), scale);
  if (!hero && scale < 0.85) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.beginPath();
    ctx.ellipse(0, 17, 29, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#050914';
    ctx.beginPath();
    ctx.moveTo(-12, 4);
    ctx.lineTo(-34, 12);
    ctx.lineTo(-27, 21);
    ctx.lineTo(-9, 16);
    ctx.lineTo(9, 16);
    ctx.lineTo(27, 21);
    ctx.lineTo(34, 12);
    ctx.lineTo(12, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-12, 2);
    ctx.lineTo(-32, 10);
    ctx.lineTo(-26, 17);
    ctx.lineTo(-9, 13);
    ctx.lineTo(9, 13);
    ctx.lineTo(26, 17);
    ctx.lineTo(32, 10);
    ctx.lineTo(12, 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#050914';
    ctx.beginPath();
    ctx.moveTo(0, -37);
    ctx.lineTo(9, -29);
    ctx.lineTo(13, -12);
    ctx.lineTo(20, 18);
    ctx.lineTo(13, 27);
    ctx.lineTo(7, 23);
    ctx.lineTo(-7, 23);
    ctx.lineTo(-13, 27);
    ctx.lineTo(-20, 18);
    ctx.lineTo(-13, -12);
    ctx.lineTo(-9, -29);
    ctx.closePath();
    ctx.fill();

    const rivalHull = ctx.createLinearGradient(-18, -35, 18, 19);
    rivalHull.addColorStop(0, '#f8fafc');
    rivalHull.addColorStop(0.16, color);
    rivalHull.addColorStop(0.56, color);
    rivalHull.addColorStop(1, '#101827');
    ctx.fillStyle = rivalHull;
    ctx.beginPath();
    ctx.moveTo(0, -39);
    ctx.lineTo(7, -32);
    ctx.lineTo(11, -15);
    ctx.lineTo(16, 5);
    ctx.lineTo(18, 12);
    ctx.lineTo(11, 17);
    ctx.lineTo(6, 13);
    ctx.lineTo(-6, 13);
    ctx.lineTo(-11, 17);
    ctx.lineTo(-18, 12);
    ctx.lineTo(-16, 5);
    ctx.lineTo(-11, -15);
    ctx.lineTo(-7, -32);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    ctx.fillStyle = 'rgba(2, 6, 23, 0.76)';
    ctx.beginPath();
    ctx.moveTo(0, -27);
    ctx.lineTo(7, -18);
    ctx.lineTo(5, -4);
    ctx.lineTo(0, 1);
    ctx.lineTo(-5, -4);
    ctx.lineTo(-7, -18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(4, -17);
    ctx.lineTo(3, -6);
    ctx.lineTo(0, -2);
    ctx.lineTo(-3, -6);
    ctx.lineTo(-4, -17);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-2, -18);
    ctx.lineTo(0, -22);
    ctx.stroke();

    ctx.fillStyle = '#07111e';
    ctx.fillRect(-18, 12, 36, 3);
    ctx.fillStyle = '#67e8f9';
    ctx.fillRect(-13, 15, 5, 2);
    ctx.fillRect(8, 15, 5, 2);
    ctx.restore();
    return;
  }

  ctx.shadowColor = hero ? '#22d3ee' : color;
  ctx.shadowBlur = hero ? 18 : 8;

  const groundShadow = ctx.createRadialGradient(0, 18, 3, 0, 19, 39);
  groundShadow.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  groundShadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = groundShadow;
  ctx.beginPath();
  ctx.ellipse(0, 19, 38, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  const outline = [
    [0, -42], [8, -35], [11, -19], [16, -4], [20, 10],
    [14, 20], [8, 16], [0, 18], [-8, 16], [-14, 20],
    [-20, 10], [-16, -4], [-11, -19], [-8, -35]
  ];
  const thickness = hero ? 16 : 12;
  const traceHull = offset => {
    ctx.beginPath();
    outline.forEach(([px, py], index) => {
      if (index === 0) ctx.moveTo(px, py + offset);
      else ctx.lineTo(px, py + offset);
    });
    ctx.closePath();
  };

  ctx.fillStyle = '#050a12';
  traceHull(thickness + 2);
  ctx.fill();

  const rightSide = ctx.createLinearGradient(10, -8, 23, 18);
  rightSide.addColorStop(0, '#64748b');
  rightSide.addColorStop(0.28, '#263449');
  rightSide.addColorStop(1, '#050914');
  ctx.fillStyle = rightSide;
  ctx.beginPath();
  ctx.moveTo(8, -35);
  ctx.lineTo(11, -19);
  ctx.lineTo(16, -4);
  ctx.lineTo(20, 10);
  ctx.lineTo(14, 20);
  ctx.lineTo(14, 20 + thickness);
  ctx.lineTo(20, 10 + thickness);
  ctx.lineTo(16, -4 + thickness);
  ctx.lineTo(11, -19 + thickness);
  ctx.lineTo(8, -35 + thickness);
  ctx.closePath();
  ctx.fill();

  const leftSide = ctx.createLinearGradient(-10, -8, -23, 18);
  leftSide.addColorStop(0, '#dbeafe');
  leftSide.addColorStop(0.24, color);
  leftSide.addColorStop(0.72, '#172033');
  leftSide.addColorStop(1, '#050914');
  ctx.fillStyle = leftSide;
  ctx.beginPath();
  ctx.moveTo(-8, -35);
  ctx.lineTo(-11, -19);
  ctx.lineTo(-16, -4);
  ctx.lineTo(-20, 10);
  ctx.lineTo(-14, 20);
  ctx.lineTo(-14, 20 + thickness);
  ctx.lineTo(-20, 10 + thickness);
  ctx.lineTo(-16, -4 + thickness);
  ctx.lineTo(-11, -19 + thickness);
  ctx.lineTo(-8, -35 + thickness);
  ctx.closePath();
  ctx.fill();

  const keel = ctx.createLinearGradient(0, 9, 0, 34);
  keel.addColorStop(0, '#64748b');
  keel.addColorStop(0.28, '#1e293b');
  keel.addColorStop(1, '#020617');
  ctx.fillStyle = keel;
  ctx.beginPath();
  ctx.moveTo(-8, 8);
  ctx.lineTo(8, 8);
  ctx.lineTo(6, 25);
  ctx.lineTo(0, 33);
  ctx.lineTo(-6, 25);
  ctx.closePath();
  ctx.fill();

  for (const side of [-1, 1]) {
    const podPath = offset => {
      ctx.beginPath();
      ctx.moveTo(side * 12, -9 + offset);
      ctx.lineTo(side * 18, -13 + offset);
      ctx.lineTo(side * 23, -5 + offset);
      ctx.lineTo(side * 22, 10 + offset);
      ctx.lineTo(side * 17, 18 + offset);
      ctx.lineTo(side * 12, 13 + offset);
      ctx.closePath();
    };

    ctx.fillStyle = '#050914';
    podPath(6);
    ctx.fill();
    const pod = ctx.createLinearGradient(side * 22, -9, side * 12, 15);
    pod.addColorStop(0, '#f8fafc');
    pod.addColorStop(0.16, color);
    pod.addColorStop(0.48, '#334155');
    pod.addColorStop(0.82, '#111827');
    pod.addColorStop(1, '#050914');
    ctx.fillStyle = pod;
    podPath(0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.beginPath();
    ctx.moveTo(side * 17, -8);
    ctx.lineTo(side * 20, -4);
    ctx.lineTo(side * 19, 5);
    ctx.lineTo(side * 16, 8);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.ellipse(side * 16.5, 17, 5.2, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    const nozzle = ctx.createLinearGradient(0, 11, 0, 21);
    nozzle.addColorStop(0, '#cbd5e1');
    nozzle.addColorStop(0.45, '#475569');
    nozzle.addColorStop(1, '#020617');
    ctx.fillStyle = nozzle;
    ctx.beginPath();
    ctx.ellipse(side * 16.5, 16.5, 3.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = hero ? 14 : 6;
    ctx.fillStyle = '#67e8f9';
    ctx.beginPath();
    ctx.ellipse(side * 16.5, 17, 1.8, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.fillStyle = '#050914';
  ctx.beginPath();
  ctx.moveTo(-12, 4);
  ctx.lineTo(-38, 12);
  ctx.lineTo(-31, 24);
  ctx.lineTo(-9, 18);
  ctx.lineTo(9, 18);
  ctx.lineTo(31, 24);
  ctx.lineTo(38, 12);
  ctx.lineTo(12, 4);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.translate(0, 6);
  const wing = ctx.createLinearGradient(0, 4, 0, 24);
  wing.addColorStop(0, '#e2e8f0');
  wing.addColorStop(0.18, color);
  wing.addColorStop(0.55, '#334155');
  wing.addColorStop(1, '#080e19');
  ctx.fillStyle = wing;
  ctx.beginPath();
  ctx.moveTo(-12, 3);
  ctx.lineTo(-36, 11);
  ctx.lineTo(-29, 21);
  ctx.lineTo(-9, 15);
  ctx.lineTo(9, 15);
  ctx.lineTo(29, 21);
  ctx.lineTo(36, 11);
  ctx.lineTo(12, 3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.84)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  const lowerHull = ctx.createLinearGradient(-22, -30, 22, 24);
  lowerHull.addColorStop(0, '#f8fafc');
  lowerHull.addColorStop(0.14, '#cbd5e1');
  lowerHull.addColorStop(0.22, color);
  lowerHull.addColorStop(0.56, color);
  lowerHull.addColorStop(1, '#172033');
  ctx.fillStyle = lowerHull;
  traceHull(0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.94)';
  ctx.lineWidth = hero ? 1.5 : 1;
  ctx.stroke();

  const deck = ctx.createLinearGradient(-18, -37, 17, 19);
  deck.addColorStop(0, '#ffffff');
  deck.addColorStop(0.12, '#e2e8f0');
  deck.addColorStop(0.2, color);
  deck.addColorStop(0.52, color);
  deck.addColorStop(0.74, '#334155');
  deck.addColorStop(1, '#0f172a');
  ctx.fillStyle = deck;
  ctx.beginPath();
  outline.forEach(([px, py], index) => {
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = hero ? 1.2 : 0.8;
  ctx.stroke();

  const centerRidge = ctx.createLinearGradient(-6, -32, 7, 13);
  centerRidge.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
  centerRidge.addColorStop(0.24, 'rgba(255, 255, 255, 0.36)');
  centerRidge.addColorStop(0.72, 'rgba(255, 255, 255, 0.08)');
  centerRidge.addColorStop(1, 'rgba(2, 6, 23, 0.45)');
  ctx.fillStyle = centerRidge;
  ctx.beginPath();
  ctx.moveTo(0, -39);
  ctx.lineTo(5, -32);
  ctx.lineTo(7, -13);
  ctx.lineTo(4, 8);
  ctx.lineTo(0, 14);
  ctx.lineTo(-4, 8);
  ctx.lineTo(-7, -13);
  ctx.lineTo(-5, -32);
  ctx.closePath();
  ctx.fill();

  for (const side of [-1, 1]) {
    ctx.fillStyle = '#070b15';
    ctx.beginPath();
    ctx.moveTo(side * 8, -13);
    ctx.lineTo(side * 15, -8);
    ctx.lineTo(side * 18, 5);
    ctx.lineTo(side * 14, 14);
    ctx.lineTo(side * 8, 10);
    ctx.closePath();
    ctx.fill();
    const armor = ctx.createLinearGradient(side * 17, -10, side * 8, 14);
    armor.addColorStop(0, '#f8fafc');
    armor.addColorStop(0.18, '#cbd5e1');
    armor.addColorStop(0.32, color);
    armor.addColorStop(0.74, '#334155');
    armor.addColorStop(1, '#0f172a');
    ctx.fillStyle = armor;
    ctx.beginPath();
    ctx.moveTo(side * 8, -16);
    ctx.lineTo(side * 14, -11);
    ctx.lineTo(side * 16, 3);
    ctx.lineTo(side * 12, 10);
    ctx.lineTo(side * 7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.62)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.52)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-10, -16);
  ctx.lineTo(-14, 1);
  ctx.lineTo(-17, 10);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(2, 6, 23, 0.58)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(10, -16);
  ctx.lineTo(14, 1);
  ctx.lineTo(17, 10);
  ctx.stroke();

  ctx.fillStyle = '#020617';
  ctx.beginPath();
  ctx.moveTo(0, -29);
  ctx.lineTo(9, -18);
  ctx.lineTo(7, -3);
  ctx.lineTo(0, 4);
  ctx.lineTo(-7, -3);
  ctx.lineTo(-9, -18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.lineTo(8, -19);
  ctx.lineTo(6, -4);
  ctx.lineTo(0, 1);
  ctx.lineTo(-6, -4);
  ctx.lineTo(-8, -19);
  ctx.closePath();
  ctx.fill();

  const canopy = ctx.createLinearGradient(-7, -28, 8, 4);
  canopy.addColorStop(0, '#f8fafc');
  canopy.addColorStop(0.18, hero ? '#fef08a' : '#bae6fd');
  canopy.addColorStop(0.48, hero ? '#facc15' : '#38bdf8');
  canopy.addColorStop(0.78, hero ? '#b45309' : '#155e75');
  canopy.addColorStop(1, '#020617');
  ctx.fillStyle = canopy;
  ctx.beginPath();
  ctx.moveTo(0, -27);
  ctx.lineTo(6, -18);
  ctx.lineTo(4.5, -4);
  ctx.lineTo(0, 2);
  ctx.lineTo(-4.5, -4);
  ctx.lineTo(-6, -18);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-3, -20);
  ctx.lineTo(-1, -25);
  ctx.lineTo(2, -26);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
  ctx.beginPath();
  ctx.moveTo(1, -22);
  ctx.lineTo(4, -17);
  ctx.lineTo(3, -7);
  ctx.lineTo(1, -5);
  ctx.closePath();
  ctx.fill();

  for (const side of [-1, 1]) {
    const nozzleBody = ctx.createLinearGradient(side * 11, 0, side * 20, 0);
    nozzleBody.addColorStop(0, '#cbd5e1');
    nozzleBody.addColorStop(0.28, '#475569');
    nozzleBody.addColorStop(0.72, '#111827');
    nozzleBody.addColorStop(1, '#020617');
    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.ellipse(side * 16, 25, 6, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = nozzleBody;
    ctx.beginPath();
    ctx.ellipse(side * 16, 23, 4.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.ellipse(side * 16, 24, 2.8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = hero ? 14 : 6;
    ctx.fillStyle = '#67e8f9';
    ctx.beginPath();
    ctx.ellipse(side * 16, 25, 1.7, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  const noseLight = ctx.createLinearGradient(-4, -43, 4, -35);
  noseLight.addColorStop(0, '#ffffff');
  noseLight.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = noseLight;
  ctx.beginPath();
  ctx.moveTo(0, -42);
  ctx.lineTo(5, -36);
  ctx.lineTo(0, -38);
  ctx.lineTo(-5, -36);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#070b15';
  ctx.beginPath();
  ctx.moveTo(-25, 11);
  ctx.lineTo(-15, 8);
  ctx.lineTo(15, 8);
  ctx.lineTo(25, 11);
  ctx.lineTo(20, 17);
  ctx.lineTo(8, 14);
  ctx.lineTo(-8, 14);
  ctx.lineTo(-20, 17);
  ctx.closePath();
  ctx.fill();
  const rearWing = ctx.createLinearGradient(0, 8, 0, 17);
  rearWing.addColorStop(0, '#f8fafc');
  rearWing.addColorStop(0.2, color);
  rearWing.addColorStop(0.65, '#334155');
  rearWing.addColorStop(1, '#080e19');
  ctx.fillStyle = rearWing;
  ctx.beginPath();
  ctx.moveTo(-25, 8);
  ctx.lineTo(-15, 6);
  ctx.lineTo(15, 6);
  ctx.lineTo(25, 8);
  ctx.lineTo(20, 13);
  ctx.lineTo(8, 11);
  ctx.lineTo(-8, 11);
  ctx.lineTo(-20, 13);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.shadowColor = hero ? '#22d3ee' : color;
  ctx.shadowBlur = hero ? 12 : 5;
  ctx.fillStyle = hero ? '#fb7185' : '#f8fafc';
  ctx.fillRect(-20, 11, 40, 2);
  ctx.fillStyle = '#e0f2fe';
  ctx.fillRect(-16, 11, 32, 1);

  ctx.restore();
}

function draw() {
  ctx.save();
  if (car.shake > 0) {
    ctx.translate((Math.random() - 0.5) * car.shake, (Math.random() - 0.5) * car.shake);
  }
  const speedRatio = clamp(car.speed / 24, 0, 1);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-car.tilt * 0.006);
  ctx.translate(-W / 2, -H / 2 - speedRatio * 1.5 + Math.sin(car.dist * 0.025) * speedRatio * 0.6);

  // 空・宇宙背景
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, '#050817');
  sky.addColorStop(0.62, '#17143b');
  sky.addColorStop(1, '#8a286f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, HORIZON);

  const horizonGlow = ctx.createLinearGradient(0, HORIZON - 34, 0, HORIZON + 12);
  horizonGlow.addColorStop(0, 'rgba(236, 72, 153, 0)');
  horizonGlow.addColorStop(1, 'rgba(56, 189, 248, 0.42)');
  ctx.fillStyle = horizonGlow;
  ctx.fillRect(0, HORIZON - 34, W, 46);

  const sunset = ctx.createRadialGradient(W / 2, HORIZON - 18, 2, W / 2, HORIZON - 18, 118);
  sunset.addColorStop(0, 'rgba(255, 220, 180, 0.72)');
  sunset.addColorStop(0.18, 'rgba(244, 114, 182, 0.32)');
  sunset.addColorStop(1, 'rgba(244, 114, 182, 0)');
  ctx.fillStyle = sunset;
  ctx.fillRect(W / 2 - 118, HORIZON - 136, 236, 118);

  ctx.fillStyle = 'rgba(255, 226, 190, 0.72)';
  ctx.beginPath();
  ctx.ellipse(W / 2, HORIZON - 18, 54, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 64; i++) {
    const x = (i * 137.5) % W;
    const y = (i * 47.3) % (HORIZON - 22);
    const alpha = 0.32 + (Math.sin(car.dist * 0.015 + i) + 1) * 0.22;
    ctx.fillStyle = `rgba(210, 235, 255, ${alpha})`;
    ctx.fillRect(x, y, i % 9 === 0 ? 2 : 1, i % 9 === 0 ? 2 : 1);
  }

  ctx.fillStyle = '#111630';
  ctx.beginPath();
  ctx.moveTo(0, HORIZON - 5);
  for (let x = 0; x <= W; x += 32) {
    const peak = HORIZON - 20 - (Math.sin(x * 0.025) * 13 + Math.cos(x * 0.061) * 8);
    ctx.lineTo(x, peak);
  }
  ctx.lineTo(W, HORIZON + 2);
  ctx.lineTo(0, HORIZON + 2);
  ctx.closePath();
  ctx.fill();

  const roadHeight = H - HORIZON;
  const groundGradient = ctx.createLinearGradient(0, HORIZON, 0, H);
  groundGradient.addColorStop(0, '#15353a');
  groundGradient.addColorStop(1, '#07171c');
  ctx.fillStyle = groundGradient;
  ctx.fillRect(0, HORIZON, W, roadHeight);
  for (let y = 0; y < roadHeight; y += 6) {
    if (Math.floor((y * 0.12 - car.dist * 0.09) / 18) % 2 !== 0) continue;
    ctx.fillStyle = 'rgba(45, 98, 96, 0.12)';
    ctx.fillRect(0, HORIZON + y, W, 2);
  }

  const roadGradient = ctx.createLinearGradient(0, HORIZON, 0, H);
  roadGradient.addColorStop(0, '#515065');
  roadGradient.addColorStop(0.48, '#343746');
  roadGradient.addColorStop(1, '#171d2b');
  ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const depth = i / 64;
    const { centerX, halfW } = roadAt(depth);
    if (i === 0) ctx.moveTo(centerX - halfW, HORIZON + depth * roadHeight);
    else ctx.lineTo(centerX - halfW, HORIZON + depth * roadHeight);
  }
  for (let i = 64; i >= 0; i--) {
    const depth = i / 64;
    const { centerX, halfW } = roadAt(depth);
    ctx.lineTo(centerX + halfW, HORIZON + depth * roadHeight);
  }
  ctx.closePath();
  ctx.fillStyle = roadGradient;
  ctx.fill();

  for (let y = 0; y < roadHeight; y += 2) {
    const screenY = HORIZON + y;
    const depth = (y + 1) / roadHeight;
    const { centerX, halfW } = roadAt(depth);
    const lookAhead = (1 - depth) * VIEW_DISTANCE;
    const dashPhase = (car.dist + lookAhead) % 190;
    if (dashPhase < 98) {
      const laneWidth = Math.max(1, depth * 2.4);
      ctx.fillStyle = `rgba(186, 230, 253, ${0.08 + depth * 0.25})`;
      ctx.fillRect(centerX - laneWidth / 2, screenY, laneWidth, 2 + depth * 2);
    }
    if (Math.floor((y * 0.18 - car.dist * 0.1) / 12) % 3 === 0) {
      ctx.fillStyle = `rgba(226, 232, 240, ${0.025 + depth * 0.035})`;
      ctx.fillRect(centerX - halfW, screenY, halfW * 2, 2);
    }

    const curbW = Math.max(2, halfW * 0.055);
    const curbStripe = Math.floor((y * 0.2 - car.dist * 0.12) / 8) % 2 === 0;
    ctx.fillStyle = curbStripe ? '#f43f5e' : '#e2e8f0';
    ctx.fillRect(centerX - halfW - curbW, screenY, curbW, 2);
    ctx.fillRect(centerX + halfW, screenY, curbW, 2);

    if (Math.floor(y * 0.1 - car.dist * 0.04) % 2 === 0) {
      ctx.fillStyle = `rgba(226, 232, 240, ${0.08 + depth * 0.08})`;
      const markerW = Math.max(1, depth * 3);
      ctx.fillRect(centerX - halfW * 0.34 - markerW / 2, screenY, markerW, 2);
      ctx.fillRect(centerX + halfW * 0.34 - markerW / 2, screenY, markerW, 2);
    }
  }

  drawTrackZones();
  drawStartLine(roadHeight);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = '#22d3ee';
  ctx.shadowBlur = 13;
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.9)';
  ctx.lineWidth = 2;
  for (let side = -1; side <= 1; side += 2) {
    ctx.beginPath();
    for (let i = 0; i <= 28; i++) {
      const depth = i / 28;
      const { centerX, halfW } = roadAt(depth);
      const x = centerX + side * halfW;
      const y = HORIZON + depth * roadHeight;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  drawCurveHint(roadHeight);
  drawTracksideStructures(roadHeight);
  drawSpeedLines(roadHeight);

  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 9; i++) {
      const depth = (i / 9 + car.dist * 0.00065) % 1;
      const { centerX, halfW } = roadAt(depth);
      const x = centerX + side * (halfW + 9 + depth * 20);
      const y = HORIZON + Math.pow(depth, 1.7) * roadHeight;
      const height = 5 + depth * 36;
      const width = 1 + depth * 2;
      const lightColor = i % 2 === 0 ? '#67e8f9' : '#f472b6';

      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.78)';
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - height);
      ctx.stroke();
      ctx.shadowColor = lightColor;
      ctx.shadowBlur = 5 + depth * 9;
      ctx.fillStyle = lightColor;
      ctx.fillRect(x - width * 1.7, y - height, width * 3.4, Math.max(1, width * 1.5));
      ctx.fillRect(x - width * 2, y - height * 0.48, width * 4, Math.max(1, width));
      ctx.restore();
    }
  }

  racers.forEach(racer => {
    if (racer.status !== 'racing') return;
    const playerPosition = car.dist % LAP_DISTANCE;
    const rivalPosition = racer.dist % LAP_DISTANCE;
    const gap = (rivalPosition - playerPosition + LAP_DISTANCE) % LAP_DISTANCE;
    if (gap < 85 || gap > VIEW_DISTANCE) return;
    const depth = 1 - gap / VIEW_DISTANCE;
    const { centerX, halfW } = roadAt(depth);
    const x = centerX + racer.lane * halfW * RIVAL_LANE_SCALE;
    const y = HORIZON + depth * (H - 76 - HORIZON);
    const perspectiveScale = Math.max(0.12, depth * 1.12);
    drawRacer(x, y, perspectiveScale, racer.color, false);
  });

  ctx.save();
  ctx.translate(W / 2, H - 76);
  ctx.rotate(car.tilt * 0.14);
  ctx.scale(1.12 * (1 - Math.abs(car.tilt) * 0.08), 1.12);
  if (keys.boost && car.boost > 5) {
    const flame = ctx.createLinearGradient(0, 16, 0, 58);
    flame.addColorStop(0, 'rgba(103, 232, 249, 0.95)');
    flame.addColorStop(0.45, 'rgba(59, 130, 246, 0.85)');
    flame.addColorStop(1, 'rgba(217, 70, 239, 0)');
    ctx.fillStyle = flame;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.moveTo(-16, 17);
    ctx.lineTo(-8, 48 + Math.random() * 12);
    ctx.lineTo(0, 36 + Math.random() * 18);
    ctx.lineTo(8, 50 + Math.random() * 12);
    ctx.lineTo(16, 17);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  if (car.fallTimer <= 0 && car.status !== 'retired') {
    ctx.save();
    ctx.globalAlpha = playerOpacity(performance.now());
    drawRacer(W / 2, H - 76, 1.12, effectiveMachine().color, true);
    ctx.restore();
  }

  car.sparks.forEach(s => {
    ctx.fillStyle = '#fde047';
    ctx.shadowColor = '#fb923c';
    ctx.shadowBlur = 8;
    ctx.fillRect(s.x, s.y, 4, 4);
  });
  ctx.shadowBlur = 0;

  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, W * 0.68);
  vignette.addColorStop(0, 'rgba(2, 6, 23, 0)');
  vignette.addColorStop(1, 'rgba(2, 6, 23, 0.4)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  drawRaceOverlay2D(performance.now());
}
