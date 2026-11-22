// @ts-check
// 3D描画（three.js）。読み込めない場合は render2d.js の描画を使う
// ※ ファイルは index.html に書いた順に読み込まれ、変数や関数はファイル間で共有される
// ===== WebGL 3D レンダラー（three.js）。読み込めない場合は従来の2D描画にフォールバック =====
(function () {
  if (!window.THREE) return;
  const glCanvas = document.getElementById('gl');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // 実際の影（マシンの影を路面に落とす）
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // ---- 定数 ----
  const ROAD_HALF = 70;          // 路面の半幅（ワールド単位）
  const CURB = 8;                // 縁石幅
  const WALL_H = 5;              // ガードウォール高さ
  const SEG = 24;                // 路面セグメント長（ゲーム距離）
  const ZS = 0.45;               // ゲーム距離 → ワールド奥行きの縮尺（ライバルや構造物を近く大きく見せる）
  const CURVE_K = 3.6 * ZS * ZS; // コースの横うねり倍率（カーブ半径を保つ）
  const BEHIND = 160, AHEAD = 4000;
  const ROWS = Math.ceil((BEHIND + AHEAD) / SEG) + 1;
  const GROUND_Y = -260;
  // 当たり判定用の横位置(L)をワールド座標へ: 壁際(x=0.92)で機体が壁に接する
  const LAT_SCALE = (ROAD_HALF - 8) / (0.92 * PLAYER_LANE_SCALE);
  const FOG_COLOR = 0x2a1846;
  const mod = (value, n) => ((value % n) + n) % n;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG_COLOR, 380, AHEAD * ZS);
  const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.5, 7000);

  const hemiLight = new THREE.HemisphereLight(0x9cc8ff, 0x2a1838, 0.8);
  scene.add(hemiLight);
  const sunLight = new THREE.DirectionalLight(0xffd2b0, 1.15);
  const rimLight = new THREE.DirectionalLight(0x5fdcff, 0.5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 10, far: 1600 });
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.4;
  sunLight.shadow.camera.updateProjectionMatrix();
  scene.add(sunLight, sunLight.target, rimLight, rimLight.target);

  // ---- テクスチャ生成 ----
  function canvasTexture(width, height, paint) {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    paint(c.getContext('2d'), width, height);
    return new THREE.CanvasTexture(c);
  }
  const glowTex = canvasTexture(128, 128, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, w);
  });
  // 空と遠景はコースごとに塗り直す
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 1024; skyCanvas.height = 512;
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  const skylineCanvas = document.createElement('canvas');
  skylineCanvas.width = 2048; skylineCanvas.height = 512;
  const skylineTex = new THREE.CanvasTexture(skylineCanvas);
  function paintSky(theme) {
    const g = skyCanvas.getContext('2d'), w = skyCanvas.width, h = skyCanvas.height;
    const grad = g.createLinearGradient(0, 0, 0, h);
    [0, 0.3, 0.44, 0.49, 0.505, 0.52, 1].forEach((stop, i) => grad.addColorStop(stop, theme.sky[i]));
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 420; i++) {
      const y = Math.pow(Math.random(), 1.6) * h * 0.44;
      g.fillStyle = `rgba(215,235,255,${0.3 + Math.random() * 0.7})`;
      const size = Math.random() < 0.08 ? 2 : 1;
      g.fillRect(Math.random() * w, y, size, size);
    }
    skyTex.needsUpdate = true;
  }
  function paintSkyline(theme) {
    const g = skylineCanvas.getContext('2d'), w = skylineCanvas.width, h = skylineCanvas.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = theme.buildings[2];
    g.fillRect(0, h - 200, w, 200);
    let x = 0;
    while (x < w) {
      const bw = 18 + Math.random() * 60;
      const bh = 200 + Math.pow(Math.random(), 2.2) * 200;
      g.fillStyle = Math.random() < 0.5 ? theme.buildings[0] : theme.buildings[1];
      g.fillRect(x, h - bh, bw, bh);
      for (let wy = h - bh + 6; wy < h - 4; wy += 7) {
        for (let wx = x + 3; wx < x + bw - 3; wx += 6) {
          if (Math.random() < 0.18) {
            g.fillStyle = Math.random() < 0.6 ? theme.windows[0] : theme.windows[1];
            g.fillRect(wx, wy, 2, 3);
          }
        }
      }
      if (bh > 330) { g.fillStyle = '#fb7185'; g.fillRect(x + bw / 2 - 1, h - bh - 8, 2, 8); }
      x += bw + Math.random() * 14;
    }
    skylineTex.needsUpdate = true;
  }
  skylineTex.wrapS = THREE.RepeatWrapping;
  skylineTex.repeat.set(3, 1);
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 512; signCanvas.height = 64;
  const signTex = new THREE.CanvasTexture(signCanvas);
  function paintSign(text, color) {
    const g = signCanvas.getContext('2d'), w = signCanvas.width, h = signCanvas.height;
    g.fillStyle = '#050b1a'; g.fillRect(0, 0, w, h);
    g.font = '900 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 14; g.fillStyle = '#f8fafc';
    g.fillText(text, w / 2, h / 2 + 2);
    signTex.needsUpdate = true;
  }

  // ---- 背景（空・夕日・遠景ビル群・地上グリッド） ----
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5200, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -3;
  scene.add(sky);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffc9a0, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, transparent: true
  }));
  sunSprite.scale.set(1500, 1500, 1);
  sunSprite.renderOrder = -2;
  scene.add(sunSprite);
  const skyline = new THREE.Mesh(new THREE.CylinderGeometry(4300, 4300, 820, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: skylineTex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  skyline.renderOrder = -1;
  scene.add(skyline);
  const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), new THREE.MeshBasicMaterial({ color: 0x140c28 }));
  groundPlane.rotation.x = -Math.PI / 2;
  scene.add(groundPlane);
  let grid = null;
  function makeGrid(colors) {
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      grid.material.dispose();
    }
    grid = new THREE.GridHelper(7200, 90, colors[0], colors[1]);
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    scene.add(grid);
  }

  // ---- コース形状 ----
  function trackX(s) { return curveCenterAt(s) * CURVE_K; }
  function elevAt(s) { return elevationAt(s); }
  const UP = new THREE.Vector3(0, 1, 0);
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  function newFrame() {
    return { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };
  }
  // 距離sでのコース座標系（位置・進行方向・右・上）。カーブではバンク角を付ける
  function frameAt(s, f) {
    f.p.set(trackX(s), elevAt(s), -s * ZS);
    tmpA.set(trackX(s - 6), elevAt(s - 6), -(s - 6) * ZS);
    tmpB.set(trackX(s + 6), elevAt(s + 6), -(s + 6) * ZS);
    f.t.subVectors(tmpB, tmpA).normalize();
    f.r.crossVectors(f.t, UP).normalize();
    const up0 = tmpA.crossVectors(f.r, f.t).normalize();
    const curvature = (trackX(s + 40) - 2 * trackX(s) + trackX(s - 40)) / (1600 * ZS * ZS);
    const bank = clamp(curvature * 140, -0.32, 0.32);
    const c = Math.cos(bank), sn = Math.sin(bank);
    f.u.copy(up0).multiplyScalar(c).addScaledVector(f.r, sn);
    f.r.multiplyScalar(c).addScaledVector(up0, -sn);
    return f;
  }
  function at(f, lat, h, out) {
    return out.copy(f.p).addScaledVector(f.r, lat).addScaledVector(f.u, h);
  }
  const basisMatrix = new THREE.Matrix4();
  const backVec = new THREE.Vector3();
  function orient(object, f) {
    backVec.copy(f.t).negate();
    basisMatrix.makeBasis(f.r, f.u, backVec);
    object.quaternion.setFromRotationMatrix(basisMatrix);
  }

  // ---- 毎フレーム再構築する路面ジオメトリ ----
  function makeDynamicMesh(maxQuads, material) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(maxQuads * 18);
    const nor = new Float32Array(maxQuads * 18);
    const col = new Float32Array(maxQuads * 18);
    const uv = new Float32Array(maxQuads * 12);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { geo, pos, nor, col, uv, n: 0, max: maxQuads, mesh };
  }
  // 路面のアスファルト（細かな粒と擦れ跡のテクスチャ）
  const asphaltTex = canvasTexture(512, 512, (g, w, h) => {
    const image = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const grain = 205 + Math.random() * 50 - (Math.random() < 0.04 ? 60 : 0);
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = grain;
      image.data[i * 4 + 3] = 255;
    }
    g.putImageData(image, 0, 0);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.05})`;
      g.beginPath();
      g.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 60, 6 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
  asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
  asphaltTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const litMesh = makeDynamicMesh(4200, new THREE.MeshStandardMaterial({
    vertexColors: true, map: asphaltTex, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.12, envMapIntensity: 0.5
  }));
  litMesh.mesh.receiveShadow = true;
  const neonMesh = makeDynamicMesh(3600, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));

  // 四角形を2枚の三角形で追加。手前側(a,b)と奥側(c,e)で法線を変えると、曲面がなめらかに見える
  const quadVerts = [null, null, null, null];
  const quadNormals = [null, null, null, null];
  const quadUV = [0, 0, 0, 0, 0, 0, 0, 0];
  const ORDER_FRONT = [0, 1, 2, 0, 2, 3], ORDER_BACK = [0, 2, 1, 0, 3, 2];
  const edge1 = new THREE.Vector3(), edge2 = new THREE.Vector3(), faceNormal = new THREE.Vector3();
  function pushQuad(d, a, b, c, e, normal, color, farNormal, uv) {
    if (d.n >= d.max) return;
    edge1.subVectors(b, a); edge2.subVectors(c, a);
    faceNormal.crossVectors(edge1, edge2);
    const order = faceNormal.dot(normal) >= 0 ? ORDER_FRONT : ORDER_BACK;
    quadVerts[0] = a; quadVerts[1] = b; quadVerts[2] = c; quadVerts[3] = e;
    quadNormals[0] = quadNormals[1] = normal;
    quadNormals[2] = quadNormals[3] = farNormal || normal;
    if (uv) {
      // uv = [u0, u1, v0, v1]: a=(u0,v0) b=(u1,v0) c=(u1,v1) e=(u0,v1)
      quadUV[0] = uv[0]; quadUV[1] = uv[2]; quadUV[2] = uv[1]; quadUV[3] = uv[2];
      quadUV[4] = uv[1]; quadUV[5] = uv[3]; quadUV[6] = uv[0]; quadUV[7] = uv[3];
    } else {
      quadUV.fill(0);
    }
    let o = d.n * 18, t = d.n * 12;
    for (let i = 0; i < 6; i++, o += 3, t += 2) {
      const k = order[i];
      const v = quadVerts[k], nrm = quadNormals[k];
      d.pos[o] = v.x; d.pos[o + 1] = v.y; d.pos[o + 2] = v.z;
      d.nor[o] = nrm.x; d.nor[o + 1] = nrm.y; d.nor[o + 2] = nrm.z;
      d.col[o] = color.r; d.col[o + 1] = color.g; d.col[o + 2] = color.b;
      d.uv[t] = quadUV[k * 2]; d.uv[t + 1] = quadUV[k * 2 + 1];
    }
    d.n++;
  }
  function finishMesh(d) {
    d.geo.setDrawRange(0, d.n * 6);
    d.geo.attributes.position.needsUpdate = true;
    d.geo.attributes.normal.needsUpdate = true;
    d.geo.attributes.color.needsUpdate = true;
    d.geo.attributes.uv.needsUpdate = true;
  }

  const C = {
    asphaltA: new THREE.Color(0x3d4155), asphaltB: new THREE.Color(0x33364a),
    curbRed: new THREE.Color(0xe11d48), curbWhite: new THREE.Color(0xe2e8f0),
    checkerW: new THREE.Color(0xc9d0db), checkerB: new THREE.Color(0x0f172a),
    dashA: new THREE.Color(0x0e7490), dashB: new THREE.Color(0x155e75),
    pitA: new THREE.Color(0x15803d), pitB: new THREE.Color(0x14532d),
    wall: new THREE.Color(0x26324f), skirt: new THREE.Color(0x1a1f35),
    rail: new THREE.Color(0x22d3ee), pulse: new THREE.Color(0xf472b6),
    edge: new THREE.Color(0x67e8f9), center: new THREE.Color(0x7dd3fc), lane: new THREE.Color(0x8b95a8),
    skirtGlow: new THREE.Color(0x0891b2), dashBar: new THREE.Color(0x67e8f9), pitLine: new THREE.Color(0x4ade80),
    slipA: new THREE.Color(0x5b8fb0), slipB: new THREE.Color(0x6fa3c4), slipLine: new THREE.Color(0xbae6fd),
    roughA: new THREE.Color(0x7c2d12), roughB: new THREE.Color(0x9a3412), roughLine: new THREE.Color(0xfb923c),
    jumpA: new THREE.Color(0xca8a04), jumpB: new THREE.Color(0x854d0e), jumpBar: new THREE.Color(0xfde047),
    hazardA: new THREE.Color(0xf97316), hazardB: new THREE.Color(0x111111)
  };
  const COLS = [-ROAD_HALF - CURB];
  for (let x = -ROAD_HALF; x <= ROAD_HALF; x += 10) COLS.push(x);
  COLS.push(ROAD_HALF + CURB);
  const JUMP_RAMP = SEG * 4;   // ジャンプ台の踏切部分の長さ（ゲーム距離）
  const zoneInBand = (zone, lat) => zone.width > 1 || Math.abs(lat / LAT_SCALE - zone.lane) < zone.width / 2;

  function roadColor(segIdx, col, prog, lat) {
    if (col === 0 || col === COLS.length - 2) return mod(segIdx, 2) ? C.curbRed : C.curbWhite;
    if (prog < SEG * 2) return mod(segIdx + col, 2) ? C.checkerW : C.checkerB;
    const alt = mod(segIdx, 2);
    for (const zone of TRACK_ZONES) {
      if (prog < zone.start || prog >= zone.end || !zoneInBand(zone, lat)) continue;
      if (zone.type === 'dash') return alt ? C.dashA : C.dashB;
      if (zone.type === 'pit') return alt ? C.pitA : C.pitB;
      if (zone.type === 'slip') return alt ? C.slipA : C.slipB;
      if (zone.type === 'rough') return mod(segIdx + col, 2) ? C.roughA : C.roughB;
      if (zone.type === 'jump' && prog < zone.start + JUMP_RAMP) return alt ? C.jumpA : C.jumpB;
    }
    return mod(Math.floor(segIdx / 2), 2) ? C.asphaltA : C.asphaltB;
  }

  const rowFrames = Array.from({ length: ROWS + 1 }, newFrame);
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
  const sideNormal = new THREE.Vector3();
  const roadUV = [0, 0, 0, 0];
  function lineQuad(f0, f1, lat, width, h, color) {
    at(f0, lat - width / 2, h, v0); at(f0, lat + width / 2, h, v1);
    at(f1, lat + width / 2, h, v2); at(f1, lat - width / 2, h, v3);
    pushQuad(neonMesh, v0, v1, v2, v3, f0.u, color);
  }
  function buildTrack() {
    const startIdx = Math.floor((car.dist - BEHIND) / SEG);
    for (let r = 0; r <= ROWS; r++) frameAt((startIdx + r) * SEG, rowFrames[r]);
    litMesh.n = 0;
    neonMesh.n = 0;
    for (let r = 0; r < ROWS; r++) {
      const segIdx = startIdx + r;
      const f0 = rowFrames[r], f1 = rowFrames[r + 1];
      const prog = mod((segIdx + 0.5) * SEG, LAP_DISTANCE);

      for (let c = 0; c < COLS.length - 1; c++) {
        const a = COLS[c], b = COLS[c + 1];
        at(f0, a, 0, v0); at(f0, b, 0, v1); at(f1, b, 0, v2); at(f1, a, 0, v3);
        roadUV[0] = a / 22; roadUV[1] = b / 22;
        roadUV[2] = (segIdx * SEG * ZS) / 22; roadUV[3] = ((segIdx + 1) * SEG * ZS) / 22;
        pushQuad(litMesh, v0, v1, v2, v3, f0.u, roadColor(segIdx, c, prog, (a + b) / 2), f1.u, roadUV);
      }

      for (let side = -1; side <= 1; side += 2) {
        const e = side * (ROAD_HALF + CURB);
        sideNormal.copy(f0.r).multiplyScalar(-side);
        const open = railOpenAt((segIdx + 0.5) * SEG, side);
        if (open) {
          // ガードレールなし区間: 壁を描かず、縁に警告ストライプ
          lineQuad(f0, f1, e - side * 1.5, 3, 0.1, mod(segIdx, 2) ? C.hazardA : C.hazardB);
        } else {
          at(f0, e, 0, v0); at(f1, e, 0, v1); at(f1, e, WALL_H, v2); at(f0, e, WALL_H, v3);
          pushQuad(litMesh, v0, v1, v2, v3, sideNormal, C.wall);
          at(f0, e, WALL_H, v0); at(f1, e, WALL_H, v1); at(f1, e, WALL_H + 1.3, v2); at(f0, e, WALL_H + 1.3, v3);
          pushQuad(neonMesh, v0, v1, v2, v3, sideNormal, C.rail);
        }
        if (!open && mod(segIdx, 6) < 2) {
          at(f0, e - side * 0.05, 1.6, v0); at(f1, e - side * 0.05, 1.6, v1);
          at(f1, e - side * 0.05, 2.5, v2); at(f0, e - side * 0.05, 2.5, v3);
          pushQuad(neonMesh, v0, v1, v2, v3, sideNormal, C.pulse);
        }
        sideNormal.copy(f0.r).multiplyScalar(side);
        at(f0, e, 0, v0); at(f1, e, 0, v1); at(f1, e - side * 6, -14, v2); at(f0, e - side * 6, -14, v3);
        pushQuad(litMesh, v0, v1, v2, v3, sideNormal, C.skirt);
        at(f0, e - side * 0.6, -2.2, v0); at(f1, e - side * 0.6, -2.2, v1);
        at(f1, e - side * 1.0, -3.6, v2); at(f0, e - side * 1.0, -3.6, v3);
        pushQuad(neonMesh, v0, v1, v2, v3, sideNormal, C.skirtGlow);
        lineQuad(f0, f1, side * ROAD_HALF, 1.6, 0.08, C.edge);
      }

      if (mod(segIdx, 4) < 2) {
        lineQuad(f0, f1, 0, 1.2, 0.08, C.center);
        lineQuad(f0, f1, -ROAD_HALF * 0.45, 0.9, 0.08, C.lane);
        lineQuad(f0, f1, ROAD_HALF * 0.45, 0.9, 0.08, C.lane);
      }
      for (const zone of TRACK_ZONES) {
        if (prog < zone.start || prog >= zone.end) continue;
        if (zone.type === 'dash' && mod(segIdx, 3) === 0) lineQuad(f0, f1, 0, ROAD_HALF * 1.8, 0.12, C.dashBar);
        if (zone.type === 'jump' && prog < zone.start + JUMP_RAMP && mod(segIdx, 2) === 0) {
          lineQuad(f0, f1, 0, ROAD_HALF * 1.8, 0.12, C.jumpBar);
        }
        if (zone.width <= 1 && (zone.type === 'pit' || zone.type === 'slip' || zone.type === 'rough')) {
          const lineColor = zone.type === 'pit' ? C.pitLine : (zone.type === 'slip' ? C.slipLine : C.roughLine);
          lineQuad(f0, f1, (zone.lane - zone.width / 2) * LAT_SCALE, 1.2, 0.1, lineColor);
          lineQuad(f0, f1, (zone.lane + zone.width / 2) * LAT_SCALE, 1.2, 0.1, lineColor);
        }
      }
    }
    finishMesh(litMesh);
    finishMesh(neonMesh);
  }

  // ---- コース脇の構造物（支柱・街灯・ゲート・ゾーン看板） ----
  const instanceMatrix = new THREE.Matrix4();
  const scaleVec = new THREE.Vector3();
  const tmpFrame = newFrame();
  function setInstance(mesh, index, f, position, sx, sy, sz) {
    backVec.copy(f.t).negate();
    instanceMatrix.makeBasis(f.r, f.u, backVec);
    instanceMatrix.scale(scaleVec.set(sx, sy, sz));
    instanceMatrix.setPosition(position);
    mesh.setMatrixAt(index, instanceMatrix);
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  // 構造物は角のない円柱・カプセル形状にする
  const pillarGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 28);
  const ringGeoThin = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
  const poleGeo = new THREE.CylinderGeometry(0.35, 0.5, 1, 16);
  const lampGeo = new THREE.SphereGeometry(0.5, 24, 12);
  const PILLAR_MAX = 64, LAMP_MAX = 80;
  const pillars = new THREE.InstancedMesh(pillarGeo,
    new THREE.MeshStandardMaterial({ color: 0x39445f, metalness: 0.6, roughness: 0.35 }), PILLAR_MAX);
  const pillarRings = new THREE.InstancedMesh(ringGeoThin, new THREE.MeshBasicMaterial({ color: 0x8b5cf6 }), PILLAR_MAX);
  const poles = new THREE.InstancedMesh(poleGeo,
    new THREE.MeshStandardMaterial({ color: 0xaab4c4, metalness: 0.9, roughness: 0.25 }), LAMP_MAX);
  const lampHeads = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), LAMP_MAX);
  for (let i = 0; i < LAMP_MAX; i++) lampHeads.setColorAt(i, new THREE.Color(i % 4 < 2 ? 0x67e8f9 : 0xf472b6));
  [pillars, pillarRings, poles, lampHeads].forEach(mesh => {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
  });

  const gateWidth = 2 * (ROAD_HALF + CURB + 4);
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x2a3550, metalness: 0.85, roughness: 0.25 });
  const gateNeonCyan = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
  const gateNeonPink = new THREE.MeshBasicMaterial({ color: 0xf0abfc });
  const gatePostGeo = new THREE.CylinderGeometry(2.2, 2.8, 38, 32);
  const gateBeamGeo = new THREE.CylinderGeometry(3, 3, gateWidth + 6, 40).rotateZ(Math.PI / 2);
  const gateTubeGeo = new THREE.CylinderGeometry(0.45, 0.45, 1, 16);
  const gates = Array.from({ length: 8 }, () => {
    const group = new THREE.Group();
    for (let side = -1; side <= 1; side += 2) {
      const post = new THREE.Mesh(gatePostGeo, gateMat);
      post.position.set(side * gateWidth / 2, 19, 0);
      const strip = new THREE.Mesh(gateTubeGeo, gateNeonCyan);
      strip.scale.set(1, 32, 1);
      strip.position.set(side * (gateWidth / 2 - 2.3), 18, 2.2);
      group.add(post, strip);
    }
    const beam = new THREE.Mesh(gateBeamGeo, gateMat);
    beam.position.set(0, 38, 0);
    const beamNeon = new THREE.Mesh(gateTubeGeo, gateNeonPink);
    beamNeon.rotation.z = Math.PI / 2;
    beamNeon.scale.set(1, gateWidth, 1);
    beamNeon.position.set(0, 34.6, 2.2);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(64, 8), new THREE.MeshBasicMaterial({ map: signTex }));
    sign.position.set(0, 38, 1.8);
    group.add(beam, beamNeon, sign);
    scene.add(group);
    return group;
  });

  function textSprite(text, color) {
    const tex = canvasTexture(256, 96, (g, w, h) => {
      g.font = '900 66px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = color; g.shadowBlur = 20;
      g.fillStyle = '#f8fafc'; g.fillText(text, w / 2, h / 2 + 2);
      g.lineWidth = 3; g.strokeStyle = color; g.strokeText(text, w / 2, h / 2 + 2);
    });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8 }));
    sprite.scale.set(22, 8.3, 1);
    scene.add(sprite);
    return sprite;
  }
  let zoneLabels = [];
  function rebuildZoneLabels() {
    zoneLabels.forEach(({ sprite }) => {
      scene.remove(sprite);
      sprite.material.map.dispose();
      sprite.material.dispose();
    });
    zoneLabels = TRACK_ZONES.filter(zone => zone.label).map(zone => ({ zone, sprite: textSprite(zone.label, zone.color) }));
  }

  // ジャンプ台（傾いた発光プレート）
  const rampMat = new THREE.MeshStandardMaterial({ color: 0x8a6a1c, emissive: 0x2a1c00, metalness: 0.6, roughness: 0.3 });
  const ramps = Array.from({ length: 4 }, () => {
    const ramp = new THREE.Mesh(boxGeo, rampMat);
    ramp.visible = false;
    scene.add(ramp);
    return ramp;
  });
  // 地雷（黒い球体＋点滅する赤いランプ）
  const MINE_MAX = 40;
  const mineBodies = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 32, 20),
    new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.9, roughness: 0.2 }), MINE_MAX);
  const mineLights = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 12),
    new THREE.MeshBasicMaterial({ color: 0xff2d2d }), MINE_MAX);
  [mineBodies, mineLights].forEach(mesh => {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
  });
  // 爆発エフェクト
  const explosionSprites = Array.from({ length: 8 }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xff9a3c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    }));
    sprite.visible = false;
    scene.add(sprite);
    return sprite;
  });

  function updateScenery() {
    let count = 0;
    for (let s = Math.ceil((car.dist - BEHIND) / 160) * 160; s < car.dist + AHEAD && count < PILLAR_MAX - 1; s += 160) {
      frameAt(s, tmpFrame);
      for (let side = -1; side <= 1; side += 2) {
        at(tmpFrame, side * ROAD_HALF * 0.55, -14, v0);
        const height = Math.max(4, v0.y - GROUND_Y);
        v1.set(v0.x, (v0.y + GROUND_Y) / 2, v0.z);
        setInstance(pillars, count, tmpFrame, v1, 7, height, 7);
        v1.set(v0.x, v0.y - 10, v0.z);
        setInstance(pillarRings, count, tmpFrame, v1, 8.2, 1.2, 8.2);
        count++;
      }
    }
    pillars.count = pillarRings.count = count;
    pillars.instanceMatrix.needsUpdate = pillarRings.instanceMatrix.needsUpdate = true;

    count = 0;
    for (let s = Math.ceil((car.dist - BEHIND) / 120) * 120; s < car.dist + AHEAD && count < LAMP_MAX - 1; s += 120) {
      frameAt(s, tmpFrame);
      for (let side = -1; side <= 1; side += 2) {
        const lat = side * (ROAD_HALF + CURB + 2);
        at(tmpFrame, lat, 12, v0);
        setInstance(poles, count, tmpFrame, v0, 1, 24, 1);
        at(tmpFrame, lat - side * 3, 24, v0);
        setInstance(lampHeads, count, tmpFrame, v0, 8, 1.1, 2.4);
        count++;
      }
    }
    poles.count = lampHeads.count = count;
    poles.instanceMatrix.needsUpdate = lampHeads.instanceMatrix.needsUpdate = true;

    let gi = 0;
    for (let s = Math.ceil((car.dist - BEHIND) / 720) * 720; s < car.dist + AHEAD && gi < gates.length; s += 720) {
      frameAt(s, tmpFrame);
      gates[gi].visible = true;
      gates[gi].position.copy(tmpFrame.p);
      orient(gates[gi], tmpFrame);
      gi++;
    }
    for (; gi < gates.length; gi++) gates[gi].visible = false;

    // 次に現れるゾーン開始地点（今の周か次の周）
    const nextZoneStart = zone => {
      let s = Math.floor(car.dist / LAP_DISTANCE) * LAP_DISTANCE + zone.start;
      if (s + 40 < car.dist) s += LAP_DISTANCE;
      return s;
    };
    zoneLabels.forEach(({ zone, sprite }) => {
      const s = nextZoneStart(zone);
      if (s - car.dist > AHEAD) { sprite.visible = false; return; }
      sprite.visible = true;
      frameAt(s + 40, tmpFrame);
      // 近づくほど薄くし、手前でコースを隠さないようにする
      const distanceAhead = s - car.dist;
      sprite.material.opacity = clamp((distanceAhead - 150) / 500, 0, 0.8);
      at(tmpFrame, zone.width > 1 ? 0 : zone.lane * LAT_SCALE, 30, sprite.position);
    });

    let ri = 0;
    TRACK_ZONES.forEach(zone => {
      if (zone.type !== 'jump' || ri >= ramps.length) return;
      let s = Math.floor(car.dist / LAP_DISTANCE) * LAP_DISTANCE + zone.start;
      if (s + JUMP_RAMP < car.dist - BEHIND) s += LAP_DISTANCE;
      if (s - car.dist > AHEAD) return;
      const ramp = ramps[ri++];
      const rampLen = JUMP_RAMP * ZS;
      frameAt(s + JUMP_RAMP / 2, tmpFrame);
      at(tmpFrame, 0, 2.4, ramp.position);
      orient(ramp, tmpFrame);
      ramp.rotateX(Math.atan2(5, rampLen));
      ramp.scale.set(ROAD_HALF * 2, 0.8, rampLen);
      ramp.visible = true;
    });
    for (; ri < ramps.length; ri++) ramps[ri].visible = false;

    let mi = 0;
    const blink = 0.7 + Math.abs(Math.sin(performance.now() * 0.008)) * 0.6;
    const firstLap = Math.floor((car.dist - BEHIND) / LAP_DISTANCE);
    const lastLap = Math.floor((car.dist + AHEAD) / LAP_DISTANCE);
    for (let lap = firstLap; lap <= lastLap; lap++) {
      course.mines.forEach((mine, index) => {
        const s = lap * LAP_DISTANCE + mine.s;
        if (mi >= MINE_MAX || s < car.dist - BEHIND || s > car.dist + AHEAD || mineHits.has(`${lap}:${index}`)) return;
        frameAt(s, tmpFrame);
        at(tmpFrame, mine.lane * LAT_SCALE, 2.2, v0);
        setInstance(mineBodies, mi, tmpFrame, v0, 2.4, 2.4, 2.4);
        at(tmpFrame, mine.lane * LAT_SCALE, 4.4, v0);
        setInstance(mineLights, mi, tmpFrame, v0, blink, blink, blink);
        mi++;
      });
    }
    mineBodies.count = mineLights.count = mi;
    mineBodies.instanceMatrix.needsUpdate = mineLights.instanceMatrix.needsUpdate = true;
  }

  // 爆発（ライバルK.O.・地雷・リタイア）
  function updateExplosions(now) {
    const list = effects.explosions;
    for (let i = list.length - 1; i >= 0; i--) {
      if (now - list[i].at > 1100) list.splice(i, 1);
    }
    explosionSprites.forEach((sprite, i) => {
      const e = list[i];
      if (!e) { sprite.visible = false; return; }
      const age = now - e.at;
      frameAt(e.dist, tmpFrame);
      at(tmpFrame, e.lane * LAT_SCALE, 5 + age * 0.01, sprite.position);
      const size = (e.big ? 16 : 10) + age * (e.big ? 0.09 : 0.05);
      sprite.scale.set(size, size, 1);
      sprite.material.opacity = clamp(1 - age / 1100, 0, 1);
      sprite.material.color.setHSL(0.08 - age / 11000, 1, 0.6);
      sprite.visible = true;
    });
  }

  // ---- マシン（3Dモデル：断面をなめらかにつないだ曲面ボディ） ----
  // 周囲の映り込み（環境マップ）: 空のテクスチャとネオンの光源を球に貼ってPMREMで生成
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null;
  function updateEnvironment(theme) {
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide }));
    envScene.add(envSky);
    // 映り込み用の光源（ネオン看板・街灯の帯・太陽）
    const strip = (color, x, y, z, w, h, ry) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      envScene.add(mesh);
    };
    strip(0x67e8f9, -40, 8, 0, 60, 3, Math.PI / 2);
    strip(0xf472b6, 40, 6, 0, 60, 3, -Math.PI / 2);
    strip(0xffffff, 0, 30, 0, 40, 6, 0);
    strip(new THREE.Color(theme.sun).getHex(), 0, 4, -45, 30, 12, 0);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ color: 0x9fb4d8 }));
    top.position.y = 45;
    top.rotation.x = Math.PI / 2;
    envScene.add(top);
    const next = pmrem.fromScene(envScene, 0.035);
    scene.environment = next.texture;
    if (envTarget) envTarget.dispose();
    envTarget = next;
    envScene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }

  // 断面（スーパー楕円）を z 方向に並べ、Catmull-Rom 補間でなめらかにつないだ形状を作る
  // keys: [{ z, w(幅), h(高さ), y(中心の高さ), n(角の丸さ 2=楕円 4〜=角丸の四角), b(下半分の高さ比) }]
  function loftGeometry(keys, rings = 44, radial = 36) {
    const positions = [];
    const indices = [];
    const interp = (u, i, get) => {
      const k0 = keys[Math.max(i - 1, 0)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(i + 2, keys.length - 1)];
      const a = get(k0), b = get(k1), c = get(k2), d = get(k3);
      return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    };
    const def = (k, key, fallback) => (k[key] !== undefined ? k[key] : fallback);
    const ringCenters = [];
    for (let r = 0; r <= rings; r++) {
      const f = (r / rings) * (keys.length - 1);
      const i = Math.min(Math.floor(f), keys.length - 2);
      const u = f - i;
      const z = interp(u, i, k => k.z);
      const w = Math.max(0.02, interp(u, i, k => k.w));
      const h = Math.max(0.02, interp(u, i, k => k.h));
      const y = interp(u, i, k => def(k, 'y', 0));
      const n = interp(u, i, k => def(k, 'n', 2.4));
      const bottom = interp(u, i, k => def(k, 'b', 1));
      ringCenters.push([0, y, z]);
      for (let j = 0; j < radial; j++) {
        const t = (j / radial) * Math.PI * 2;
        const c = Math.cos(t), s = Math.sin(t);
        const e = 2 / n;
        const x = (w / 2) * Math.sign(c) * Math.pow(Math.abs(c), e);
        const yy = (h / 2) * Math.sign(s) * Math.pow(Math.abs(s), e) * (s < 0 ? bottom : 1);
        positions.push(x, y + yy, z);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let j = 0; j < radial; j++) {
        const a = r * radial + j;
        const b = (r + 1) * radial + j;
        const c = (r + 1) * radial + (j + 1) % radial;
        const d = r * radial + (j + 1) % radial;
        indices.push(a, d, b, d, c, b);
      }
    }
    // 両端のふた（輪の頂点を複製して、縁の陰影をくっきりさせる）
    [[0, -1], [rings, 1]].forEach(([r, dir]) => {
      const centerIndex = positions.length / 3;
      positions.push(...ringCenters[r]);
      const start = positions.length / 3;
      for (let j = 0; j < radial; j++) {
        const src = (r * radial + j) * 3;
        positions.push(positions[src], positions[src + 1], positions[src + 2]);
      }
      for (let j = 0; j < radial; j++) {
        const a = start + j, b = start + (j + 1) % radial;
        if (dir > 0) indices.push(centerIndex, a, b);
        else indices.push(centerIndex, b, a);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  const canopyGeo = new THREE.SphereGeometry(1, 40, 28);
  const nozzleGeo = new THREE.CylinderGeometry(1.5, 1.2, 2.4, 32, 1, true).rotateX(Math.PI / 2);
  const nozzleLipGeo = new THREE.TorusGeometry(1.35, 0.22, 12, 40);
  const coreGeo = new THREE.CircleGeometry(1.15, 32);
  const flameGeo = new THREE.ConeGeometry(1.3, 10, 24, 1, true).rotateX(Math.PI / 2).translate(0, 0, 5);
  const underGlowGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
  const ringGeo = new THREE.TorusGeometry(1, 0.26, 24, 72);
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b2333, metalness: 0.7, roughness: 0.38, side: THREE.DoubleSide });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xc9d1dd, metalness: 1, roughness: 0.16, side: THREE.DoubleSide });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xbdf7ff });
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false
  });
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
  const shadowGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);

  function part(body, geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.rotation.set(rx, ry, rz);
    body.add(mesh);
    return mesh;
  }
  // ノズル（金属の縁取り付き）・コア・ブースト炎・グローをまとめて追加（r=ノズル半径）
  function addEngine(body, flames, glows, x, y, z, r) {
    const k = r / 1.3;
    part(body, nozzleGeo, darkMat, x, y, z, k, k, 1);
    part(body, nozzleLipGeo, metalMat, x, y, z + 1.2, k, k, k);
    part(body, coreGeo, coreMat, x, y, z + 0.9, k, k, 1).userData.core = true;
    const flame = part(body, flameGeo, flameMat, x, y, z + 1.3, k, k, 1);
    flame.visible = false;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0x5fe3ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    }));
    glow.position.set(x, y, z + 2);
    glow.userData.k = k;
    glow.scale.set(5 * k, 5 * k, 1);
    body.add(glow);
    flames.push(flame);
    glows.push(glow);
  }

  // 機種ごとの曲面パーツ（ジオメトリは全機で共有）
  const SHAPES = {
    comet: {
      body: loftGeometry([
        { z: -15.5, w: 0.3, h: 0.25, y: 1.3, n: 2.2, b: 0.6 },
        { z: -12, w: 2.8, h: 1.4, y: 1.5, n: 2.4, b: 0.6 },
        { z: -6.5, w: 5.2, h: 2.5, y: 1.9, n: 2.6, b: 0.55 },
        { z: -0.5, w: 6.8, h: 3.2, y: 2.15, n: 2.8, b: 0.5 },
        { z: 5.5, w: 7.2, h: 3.0, y: 2.2, n: 3.0, b: 0.5 },
        { z: 10.2, w: 6.2, h: 2.3, y: 2.2, n: 3.2, b: 0.5 }
      ]),
      pod: loftGeometry([
        { z: -7, w: 0.3, h: 0.3, y: 2.1 }, { z: -4, w: 2.6, h: 2.6, y: 2.1 }, { z: 2, w: 3.5, h: 3.3, y: 2.1 },
        { z: 7, w: 3.5, h: 3.3, y: 2.1 }, { z: 9.6, w: 3.0, h: 2.8, y: 2.1 }
      ]),
      wing: loftGeometry([
        { z: -3, w: 9, h: 0.2, y: 1.6, n: 6 }, { z: 0, w: 14, h: 0.6, y: 1.7, n: 6 },
        { z: 5, w: 15, h: 0.55, y: 1.8, n: 6 }, { z: 7, w: 12, h: 0.2, y: 1.8, n: 6 }
      ]),
      rearWing: loftGeometry([
        { z: 7.4, w: 20, h: 0.15, y: 4.4, n: 8 }, { z: 8.4, w: 25, h: 0.6, y: 4.5, n: 8 },
        { z: 9.8, w: 25, h: 0.4, y: 4.5, n: 8 }, { z: 10.4, w: 22, h: 0.12, y: 4.4, n: 8 }
      ]),
      plate: loftGeometry([
        { z: 7.2, w: 0.2, h: 1.5, y: 3.6, n: 5 }, { z: 8.4, w: 0.55, h: 3.6, y: 3.6, n: 5 },
        { z: 10.2, w: 0.45, h: 3.4, y: 3.6, n: 5 }, { z: 10.8, w: 0.15, h: 2.0, y: 3.6, n: 5 }
      ]),
      fin: loftGeometry([
        { z: 3, w: 0.2, h: 0.4, y: 3.6, n: 4 }, { z: 6.5, w: 0.5, h: 2.4, y: 4.4, n: 4 }, { z: 9.6, w: 0.3, h: 2.6, y: 4.6, n: 4 }
      ])
    },
    bike: {
      body: loftGeometry([
        { z: -16, w: 0.25, h: 0.25, y: 2.1 }, { z: -11, w: 2.0, h: 1.7, y: 2.2, n: 2.2 },
        { z: -4, w: 3.6, h: 3.0, y: 2.4, n: 2.4, b: 0.7 }, { z: 3, w: 4.2, h: 3.4, y: 2.6, n: 2.6, b: 0.7 },
        { z: 8, w: 3.4, h: 2.8, y: 2.6, n: 2.6 }, { z: 10.4, w: 2.6, h: 2.3, y: 2.6, n: 2.6 }
      ]),
      fork: loftGeometry([
        { z: -14, w: 0.15, h: 0.3, y: 1.3, n: 3 }, { z: -11, w: 0.6, h: 1.3, y: 1.4, n: 3 },
        { z: -5, w: 0.6, h: 1.3, y: 1.6, n: 3 }, { z: -2.5, w: 0.2, h: 0.4, y: 1.8, n: 3 }
      ]),
      fin: loftGeometry([
        { z: 4, w: 2, h: 0.15, y: 3.4, n: 6 }, { z: 6.5, w: 6, h: 0.35, y: 3.4, n: 6 }, { z: 8.4, w: 5, h: 0.15, y: 3.4, n: 6 }
      ]),
      spine: loftGeometry([
        { z: -2, w: 0.3, h: 0.3, y: 4.0 }, { z: 1, w: 2.4, h: 1.1, y: 4.3, n: 3 }, { z: 7, w: 2.4, h: 1.0, y: 4.1, n: 3 }, { z: 9, w: 0.6, h: 0.4, y: 3.8 }
      ])
    },
    titan: {
      body: loftGeometry([
        { z: -15, w: 9, h: 1.4, y: 1.6, n: 4, b: 0.7 }, { z: -12.5, w: 17, h: 3.4, y: 2.4, n: 4.2 },
        { z: -4, w: 21.5, h: 4.6, y: 2.9, n: 4.6 }, { z: 6, w: 22.5, h: 4.8, y: 3.0, n: 4.6 },
        { z: 11.5, w: 20, h: 4.3, y: 3.0, n: 4.6 }, { z: 13.4, w: 17, h: 3.6, y: 3.0, n: 4.2 }
      ]),
      armor: loftGeometry([
        { z: -7, w: 4, h: 0.6, y: 5.3, n: 3 }, { z: -2, w: 12, h: 1.8, y: 5.6, n: 4 },
        { z: 8, w: 13, h: 1.6, y: 5.5, n: 4 }, { z: 11.5, w: 9, h: 0.8, y: 5.3, n: 4 }
      ]),
      pod: loftGeometry([
        { z: -8, w: 0.8, h: 1, y: 3.0, n: 4 }, { z: -5, w: 3.6, h: 4.2, y: 3.0, n: 4.5 },
        { z: 8, w: 3.8, h: 4.4, y: 3.0, n: 4.5 }, { z: 10.5, w: 3.2, h: 3.8, y: 3.0, n: 4.5 }
      ]),
      bumper: loftGeometry([
        { z: -16, w: 12, h: 0.6, y: 1.4, n: 6 }, { z: -15, w: 19, h: 2.0, y: 1.6, n: 6 }, { z: -13.2, w: 20, h: 2.0, y: 1.6, n: 6 }, { z: -12.4, w: 18, h: 0.8, y: 1.6, n: 6 }
      ])
    },
    needle: {
      body: loftGeometry([
        { z: -23, w: 0.08, h: 0.08, y: 2.6 }, { z: -17, w: 1.5, h: 1.4, y: 2.6, n: 2.1 },
        { z: -8, w: 3.4, h: 3.2, y: 2.6, n: 2.2 }, { z: 0, w: 4.4, h: 4.0, y: 2.6, n: 2.4, b: 0.8 },
        { z: 8, w: 4.6, h: 4.2, y: 2.6, n: 2.4, b: 0.8 }, { z: 11.6, w: 4.0, h: 3.6, y: 2.6, n: 2.4 }
      ]),
      wing: loftGeometry([
        { z: -7, w: 1, h: 0.2, y: 1.8, n: 6 }, { z: 1, w: 13, h: 0.55, y: 1.8, n: 6 },
        { z: 8.5, w: 21, h: 0.5, y: 1.8, n: 6 }, { z: 10.8, w: 17, h: 0.2, y: 1.8, n: 6 }
      ]),
      fin: loftGeometry([
        { z: 5, w: 0.2, h: 0.4, y: 4.6, n: 4 }, { z: 8.4, w: 0.45, h: 3.8, y: 5.6, n: 4 }, { z: 10.8, w: 0.25, h: 3.2, y: 5.9, n: 4 }
      ])
    }
  };

  const SHIP_BUILDERS = {
    comet(body, paint, glass, flames, glows) {
      const s = SHAPES.comet;
      part(body, s.body, paint, 0, 0, 0);
      part(body, s.wing, darkMat, 0, 0, 0);
      part(body, s.rearWing, paint, 0, 0, 0);
      part(body, s.fin, paint, 0, 0, 0);
      part(body, canopyGeo, glass, 0, 3.7, -3.2, 2.1, 1.35, 4.6);
      for (let side = -1; side <= 1; side += 2) {
        part(body, s.pod, paint, side * 6.4, 0, 0);
        part(body, s.plate, darkMat, side * 12.4, 0, 0);
        addEngine(body, flames, glows, side * 6.4, 2.1, 9.8, 1.25);
      }
      return { glow: [13, 17], shadow: [11, 14] };
    },
    bike(body, paint, glass, flames, glows) {
      const s = SHAPES.bike;
      part(body, s.body, paint, 0, 0, 0);
      part(body, s.spine, metalMat, 0, 0, 0);
      part(body, s.fin, paint, 0, 0, 0);
      part(body, canopyGeo, glass, 0, 4.1, -3.2, 1.5, 1.2, 3.8);
      for (let side = -1; side <= 1; side += 2) part(body, s.fork, darkMat, side * 2.5, 0, 0);
      part(body, ringGeo, metalMat, 0, 2.6, 9.6, 3.1, 3.1, 3.1);
      addEngine(body, flames, glows, 0, 2.6, 9.4, 2.1);
      return { glow: [7, 15], shadow: [6, 14] };
    },
    titan(body, paint, glass, flames, glows) {
      const s = SHAPES.titan;
      part(body, s.body, paint, 0, 0, 0);
      part(body, s.armor, metalMat, 0, 0, 0);
      part(body, s.bumper, darkMat, 0, 0, 0);
      part(body, canopyGeo, glass, 0, 6.5, -4.5, 2.6, 1.5, 3.4);
      for (let side = -1; side <= 1; side += 2) {
        part(body, s.pod, paint, side * 12.6, 0, 0);
        addEngine(body, flames, glows, side * 4.6, 3.0, 13.6, 1.6);
        addEngine(body, flames, glows, side * 12.6, 3.0, 10.8, 1.4);
      }
      return { glow: [17, 18], shadow: [14, 15] };
    },
    needle(body, paint, glass, flames, glows) {
      const s = SHAPES.needle;
      part(body, s.body, paint, 0, 0, 0);
      part(body, s.wing, metalMat, 0, 0, 0);
      part(body, canopyGeo, glass, 0, 4.3, -4.8, 1.45, 1.15, 4.6);
      for (let side = -1; side <= 1; side += 2) {
        part(body, s.fin, paint, side * 3.2, 0, 0, 1, 1, 1, 0, 0, -side * 0.32);
        addEngine(body, flames, glows, side * 5.6, 1.9, 9.8, 0.8);
      }
      addEngine(body, flames, glows, 0, 2.6, 11.4, 1.9);
      return { glow: [11, 20], shadow: [10, 18] };
    }
  };

  function makeShip(type, color, isHero) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    // 車体: メタリック塗装＋クリアコート（周囲の空やネオンが映り込む）
    const paint = new THREE.MeshPhysicalMaterial({
      color, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.2, side: THREE.DoubleSide
    });
    // キャノピー: 色付きの反射ガラス
    const glass = new THREE.MeshPhysicalMaterial({
      color: isHero ? 0x5a4300 : 0x0b3346, metalness: 0.3, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02,
      envMapIntensity: 1.8, transparent: true, opacity: 0.9
    });
    const flames = [];
    const glows = [];
    const dims = (SHIP_BUILDERS[type] || SHIP_BUILDERS.comet)(body, paint, glass, flames, glows);
    body.traverse(obj => {
      if (obj.isMesh && obj.material !== flameMat && obj.material !== coreMat) obj.castShadow = true;
    });
    const underGlow = new THREE.Mesh(underGlowGeo, new THREE.MeshBasicMaterial({
      color: isHero ? 0x22d3ee : color, map: glowTex, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    underGlow.scale.set(dims.glow[0], 1, dims.glow[1]);
    underGlow.position.y = -0.8;
    underGlow.userData.underGlow = true;
    body.add(underGlow);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.scale.set(dims.shadow[0], 1, dims.shadow[1]);
    scene.add(root, shadow);
    return { root, body, flames, glows, shadow, paint, glass, dims };
  }

  // ---- 装着したパーツを機体に付ける（つぶした楕円体で作るので角がなく、処理も軽い） ----
  // 機体の大きさは影の大きさ（dims.shadow = [半分の幅, 半分の長さ]）を目安にする。後ろが +z
  function addPartVisuals(ship, parts) {
    const body = ship.body, paint = ship.paint;
    const halfW = ship.dims.shadow[0], halfL = ship.dims.shadow[1];
    const rear = halfL * 0.72;
    // 楕円体（幅・高さ・奥行きは直径で指定）
    const blob = (mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const mesh = part(body, canopyGeo, mat, x, y, z, w / 2, h / 2, d / 2, rx, ry, rz);
      mesh.castShadow = true;
      return mesh;
    };
    const both = fn => { fn(-1); fn(1); };
    switch (parts.wing) {
      case 'w_down':   // 大きなリアウイング（支柱2本＋左右の翼端板）
        blob(paint, halfW * 1.7, 0.5, 3.4, 0, 7.2, rear - 1, -0.22);
        both(s => blob(darkMat, 0.7, 4, 1.2, s * halfW * 0.35, 5.3, rear - 1));
        both(s => blob(darkMat, 0.4, 2.6, 3.6, s * halfW * 0.85, 7.2, rear - 1));
        break;
      case 'w_glide':  // 左右に広い翼（少し上反り）
        both(s => blob(paint, halfW * 1.3, 0.35, 8, s * halfW * 1.05, 2.4, 1, 0, 0, s * 0.12));
        both(s => blob(metalMat, 0.4, 1.6, 2.4, s * halfW * 1.7, 3.0, 2.5));
        break;
      case 'w_aero':   // 小さな垂直フィン2枚
        both(s => blob(paint, 0.4, 3.2, 4.2, s * halfW * 0.45, 5.2, rear - 3, 0, 0, s * 0.25));
        break;
      default: break;
    }
    switch (parts.stabilizer) {
      case 's_side':   // 側面の安定板
        both(s => blob(metalMat, 0.5, 2.8, halfL * 0.75, s * halfW * 1.02, 1.6, rear * 0.3));
        break;
      case 's_gyro': { // 機体の上に浮かぶリング
        const ring = part(body, ringGeo, metalMat, 0, 6.2, 0, halfW * 0.35, halfW * 0.35, halfW * 0.35, Math.PI / 2);
        ring.userData.spin = true;
        break;
      }
      case 's_drift':  // 後ろ下の斜めフィン
        both(s => blob(paint, 0.4, 2.6, 3.4, s * halfW * 0.7, 1.2, rear, 0, 0, s * 0.6));
        break;
      default: break;
    }
    switch (parts.armor) {
      case 'a_heavy':  // 側面の装甲板
        both(s => blob(darkMat, 1.2, 2.6, halfL * 1.1, s * halfW * 0.92, 2.6, 0));
        break;
      case 'a_shield': {   // うっすら光る防御膜
        const shield = new THREE.Mesh(canopyGeo, new THREE.MeshBasicMaterial({
          color: 0x67e8f9, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false
        }));
        shield.scale.set(halfW * 1.15, 5, halfL * 1.15);
        shield.position.y = 2.5;
        body.add(shield);
        break;
      }
      default: break;
    }
    switch (parts.engine) {
      case 'e_turbo':  // 屋根の吸気口
        blob(metalMat, 2.2, 1.4, 4, 0, 5.4, 2);
        break;
      case 'e_high':
        both(s => blob(metalMat, 1.6, 1.2, 4, s * 2, 5.0, 3));
        break;
      case 'e_v12':    // 大きな吸気口と排気管
        blob(darkMat, 3.2, 2.0, 6, 0, 5.8, 2);
        both(s => blob(metalMat, 0.9, 0.9, 5, s * 2.6, 2.4, rear + 1));
        break;
      default: break;
    }
    // ブースターは炎・光の大きさで表す
    const glowScale = parts.booster === 'b_big' ? 1.4 : (parts.booster === 'b_eco' ? 0.8 : 1);
    ship.glows.forEach(glow => { glow.userData.k *= glowScale; });
  }
  // 機体を片付ける。機体ごとに作ったマテリアル（色・光など）も解放する（共有のものは残す）
  function removeShip(ship) {
    scene.remove(ship.root, ship.shadow);
    const shared = [darkMat, metalMat, coreMat, flameMat, shadowMat, ghostMat];
    ship.root.traverse(obj => {
      if (obj.material && !shared.includes(obj.material)) obj.material.dispose();
    });
    ship.paint.dispose();
    ship.glass.dispose();
  }


  // 自機は半透明にできるよう、共有マテリアルを複製して専用にする
  function makeHero(machineDef) {
    const ship = makeShip(machineDef.id, new THREE.Color(machineDef.color).getHex(), true);
    addPartVisuals(ship, machineDef.parts || {});
    ship.fadeMats = [];
    ship.opacity = 1;
    ship.root.traverse(obj => {
      if (!obj.material) return;
      obj.material = obj.material.clone();
      obj.material.userData.baseOpacity = obj.material.opacity;
      obj.material.userData.baseTransparent = obj.material.transparent;
      obj.material.userData.baseDepthWrite = obj.material.depthWrite;
      ship.fadeMats.push(obj.material);
    });
    // ガレージで選んだエンジンの光の色
    if (machineDef.glow) {
      const glow = new THREE.Color(machineDef.glow);
      ship.flames.forEach(flame => flame.material.color.copy(glow));
      ship.glows.forEach(sprite => sprite.material.color.copy(glow));
      ship.root.traverse(obj => {
        if (obj.userData.underGlow) obj.material.color.copy(glow);
        if (obj.userData.core) obj.material.color.copy(glow).lerp(new THREE.Color(0xffffff), 0.55);
      });
    }
    return ship;
  }
  function setShipOpacity(ship, opacity) {
    if (Math.abs(ship.opacity - opacity) < 0.005) return;
    const wasSolid = ship.opacity >= 0.999;
    const solid = opacity >= 0.999;
    ship.opacity = opacity;
    ship.fadeMats.forEach(mat => {
      mat.opacity = mat.userData.baseOpacity * opacity;
      mat.transparent = mat.userData.baseTransparent || !solid;
      mat.depthWrite = solid ? mat.userData.baseDepthWrite : false;
      if (wasSolid !== solid) mat.needsUpdate = true;
    });
  }
  let hero = makeHero(effectiveMachine());
  window.setHeroMachine = machineDef => {
    removeShip(hero);
    hero.fadeMats.forEach(mat => mat.dispose());
    hero = makeHero(machineDef);
  };
  const rivalShips = racers.map((racer, i) =>
    makeShip(MACHINES[(i + 1) % MACHINES.length].id, new THREE.Color(racer.color).getHex(), false));

  // オンライン対戦の相手のマシン（その人の機体・色・パーツで作り、頭上に名前を出す）
  let remoteShips = [];
  window.setRemoteShips = list => {
    remoteShips.forEach(item => {
      removeShip(item.ship);
      scene.remove(item.label);
      item.label.material.map.dispose();
      item.label.material.dispose();
    });
    remoteShips = list.map(remote => {
      const ship = makeShip(remote.machine.id, new THREE.Color(remote.machine.color).getHex(), false);
      addPartVisuals(ship, remote.machine.parts || {});
      const label = textSprite(remote.name, remote.machine.color);
      label.scale.set(16, 6, 1);
      return { pid: remote.pid, ship, label };
    });
  };

  // タイムアタックのゴースト（半透明の自己ベスト機）
  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0x9be7ff, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending
  });
  let ghostShip = null;
  window.setGhostMachine = machineId => {
    if (ghostShip) removeShip(ghostShip);
    ghostShip = null;
    if (!machineId) return;
    ghostShip = makeShip(machineId, 0x9be7ff, false);
    ghostShip.root.traverse(obj => {
      if (!obj.isMesh) return;
      obj.material = ghostMat;
      obj.castShadow = false;
    });
    ghostShip.shadow.visible = false;
    ghostShip.root.visible = false;
  };

  // コース切り替え（空・霧・路面色・看板を差し替え）
  let lightningUntil = 0;
  window.setCourse3D = courseDef => {
    const theme = courseDef.theme;
    paintSky(theme);
    paintSkyline(theme);
    paintSign(courseDef.name, courseDef.accent);
    scene.fog.color.setHex(theme.fog);
    groundPlane.material.color.setHex(theme.ground);
    sunSprite.material.color.setHex(theme.sun);
    C.asphaltA.setHex(theme.asphalt[0]);
    C.asphaltB.setHex(theme.asphalt[1]);
    C.wall.setHex(theme.wall);
    makeGrid(theme.grid);
    rebuildZoneLabels();
    updateEnvironment(theme);
  };

  const shipEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  function placeShip(ship, s, lat, yaw, roll, hover, now) {
    frameAt(s, tmpFrame);
    at(tmpFrame, lat, 0, ship.root.position);
    orient(ship.root, tmpFrame);
    ship.body.position.y = hover + Math.sin(now * 0.006 + s * 0.01) * 0.35;
    shipEuler.set(0, yaw, roll);
    ship.body.quaternion.setFromEuler(shipEuler);
    at(tmpFrame, lat, 0.15, ship.shadow.position);
    ship.shadow.quaternion.copy(ship.root.quaternion);
  }

  // ---- カメラ ----
  const camFrame = newFrame(), lookFrame = newFrame();
  const camState = { lat: 0, fov: 70 };
  const lookAt = new THREE.Vector3(), heroScreen = new THREE.Vector3();
  const camUp = new THREE.Vector3(0, 1, 0);

  // ネオン・ライト・炎が光をにじませるブルーム（追加スクリプトが読めた場合のみ）
  let composer = null;
  if (THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass) {
    try {
      composer = new THREE.EffectComposer(renderer);
      composer.addPass(new THREE.RenderPass(scene, camera));
      composer.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(800, 450), 0.5, 0.4, 0.86));
    } catch (error) {
      composer = null;
    }
  }
  function resize() {
    const width = glCanvas.clientWidth || 800, height = glCanvas.clientHeight || 450;
    renderer.setSize(width, height, false);
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  window.resize3D = resize;
  resize();

  // 画質: 高画質=影・光のにじみ・高解像度 / 軽量=スマホでも滑らかに動くよう省略
  let useBloom = Boolean(composer);
  let currentQuality = null;
  window.setRenderQuality = quality => {
    if (quality === currentQuality) return;
    currentQuality = quality;
    const high = quality !== 'low';
    renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio || 1, 2) : Math.min(window.devicePixelRatio || 1, 1.25));
    renderer.shadowMap.enabled = high;
    sunLight.castShadow = high;
    shadowMat.opacity = high ? 0.22 : 0.42;   // 影を省略するときは丸い影を濃くする
    useBloom = high && Boolean(composer);
    scene.traverse(obj => {
      if (obj.material) [].concat(obj.material).forEach(mat => { mat.needsUpdate = true; });
    });
    resize();
  };

  function drawOverlay(dx, dy, now) {
    ctx.clearRect(0, 0, W, H);
    if (car.status === 'racing' && raceStarted) drawSpeedLines(H - HORIZON);
    ctx.save();
    ctx.translate(dx, dy);
    car.sparks.forEach(s => {
      ctx.fillStyle = '#fde047';
      ctx.shadowColor = '#fb923c';
      ctx.shadowBlur = 8;
      ctx.fillRect(s.x, s.y, 4, 4);
    });
    ctx.restore();
    const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.68);
    vignette.addColorStop(0, 'rgba(2, 6, 23, 0)');
    vignette.addColorStop(1, 'rgba(2, 6, 23, 0.45)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
    drawRaceOverlay2D(now);
  }

  window.render3D = function (now) {
    const speedRatio = clamp(car.speed / 24, 0, 1);
    const boosting = keys.boost && car.boost > 5 && car.energy > 0 && car.status === 'racing' && raceStarted;
    const drifting = keys.drift && car.speed > 6 && car.status === 'racing';
    const steer = car.steerAxis || 0;
    const playerLat = car.x * PLAYER_LANE_SCALE * LAT_SCALE;

    buildTrack();
    updateScenery();

    updateExplosions(now);

    // 自機（リタイアしたら消える）
    const falling = car.fallTimer > 0;
    hero.root.visible = car.status !== 'retired';
    hero.shadow.visible = hero.root.visible && !falling;
    placeShip(hero, car.dist, playerLat,
      -car.tilt * 0.14 - (drifting ? steer * 0.16 : 0),
      -car.tilt * 0.28 - (drifting ? steer * 0.06 : 0) + (falling ? car.fallSpin : 0),
      3.2 + airHeightAt(car.dist) - (falling ? car.fallDepth : 0), now);
    setShipOpacity(hero, playerOpacity(now));

    // ゴースト
    if (ghostShip) {
      ghostShip.root.visible = ghostState.visible;
      if (ghostState.visible) {
        placeShip(ghostShip, ghostState.dist, ghostState.x * PLAYER_LANE_SCALE * LAT_SCALE, 0, 0,
          3.2 + airHeightAt(ghostState.dist), now);
      }
    }
    hero.body.children.forEach(child => {
      if (child.userData.spin) child.rotation.z = now * 0.004;   // ジャイロのリングを回す
    });
    hero.flames.forEach(flame => {
      flame.visible = boosting;
      flame.scale.set(1, 1, 0.8 + Math.random() * 0.7);
    });
    hero.glows.forEach(glow => {
      const size = (4 + speedRatio * 4 + (boosting ? 5 : 0) + Math.random() * 0.8) * glow.userData.k;
      glow.scale.set(size, size, 1);
    });

    // ライバル
    racers.forEach((racer, i) => {
      const ship = rivalShips[i];
      const rp = mod(racer.dist, LAP_DISTANCE), pp = mod(car.dist, LAP_DISTANCE);
      const gap = mod(rp - pp + LAP_DISTANCE / 2, LAP_DISTANCE) - LAP_DISTANCE / 2;
      const visible = !selectingMachine && racer.status === 'racing' && gap > -BEHIND + 30 && gap < AHEAD;
      ship.root.visible = ship.shadow.visible = visible;
      if (!visible) return;
      const laneVel = clamp((racer.targetLane - racer.lane) * 1.4, -0.35, 0.35);
      placeShip(ship, car.dist + gap, racer.lane * RIVAL_LANE_SCALE * LAT_SCALE, -laneVel * 0.6, -laneVel,
        3.2 + airHeightAt(racer.dist), now);
    });

    // オンライン対戦の相手
    remoteShips.forEach(item => {
      const r = online.remotes.get(item.pid);
      const visible = Boolean(r) && !selectingMachine && raceMode === 'online' && r.status !== 'retired' && !r.falling
        && r.d - car.dist > -BEHIND + 30 && r.d - car.dist < AHEAD;
      item.ship.root.visible = item.ship.shadow.visible = item.label.visible = visible;
      if (!visible) return;
      const lat = r.x * PLAYER_LANE_SCALE * LAT_SCALE;
      placeShip(item.ship, r.d, lat, -r.tilt * 0.14, -r.tilt * 0.28, 3.2 + airHeightAt(r.d), now);
      at(tmpFrame, lat, 15, item.label.position);
    });

    frameAt(car.dist, camFrame);
    let targetFov;
    // カウントダウン中は横から後ろへ回り込み、ゴール・リタイア後は周りを回る
    const countdownLeft = countdown.active ? clamp(1 - (now - countdown.startAt) / 2800, 0, 1) : 0;
    const orbiting = selectingMachine || car.status !== 'racing';
    if (orbiting || countdownLeft > 0) {
      const hp = hero.root.position;
      let angle, radius, height, lift;
      if (selectingMachine) {
        // 機体を大きめに、カードの下・ボタンの上のあいた所に映す
        angle = now * 0.00035; radius = 40; height = 13; lift = 12; targetFov = 44;
      } else if (car.status !== 'racing') {
        angle = 2.6 + (now - finishAt) * 0.0005; radius = 40; height = 13; lift = 5; targetFov = 55;
      } else {
        const eased = countdownLeft * countdownLeft * (3 - 2 * countdownLeft);
        angle = eased * 2.2; radius = 38 + eased * 6; height = 18 - eased * 6; lift = 5; targetFov = 70;
      }
      camera.position.copy(hp)
        .addScaledVector(camFrame.t, -Math.cos(angle) * radius)
        .addScaledVector(camFrame.r, Math.sin(angle) * radius)
        .addScaledVector(camFrame.u, height);
      camera.up.copy(camFrame.u);
      lookAt.copy(hp).addScaledVector(camFrame.u, lift);
      if (!orbiting) {
        // 回り込みの最後は通常の追従カメラの注視点へなめらかにつなぐ
        frameAt(car.dist + 85 / ZS, lookFrame);
        at(lookFrame, 0, 5, v2);
        lookAt.lerp(v2, 1 - countdownLeft);
      }
      camera.lookAt(lookAt);
      camState.lat = playerLat * 0.72;
    } else {
      // カメラ（自機の後方・上空から追従）
      camState.lat += (playerLat * 0.72 - camState.lat) * 0.12;
      // 自機地点の座標系を基準に、後方38・上方18へカメラを置く（坂でも距離感が一定）
      frameAt(car.dist + 85 / ZS, lookFrame);
      at(camFrame, camState.lat, 18, camera.position).addScaledVector(camFrame.t, -38);
      at(lookFrame, camState.lat * 0.6 + playerLat * 0.25, 5, lookAt);
      if (car.shake > 0) {
        camera.position.x += (Math.random() - 0.5) * car.shake * 0.35;
        camera.position.y += (Math.random() - 0.5) * car.shake * 0.35;
      }
      // 傾き操作中は、スマホを回すのに合わせて画面も少し傾け、ハンドルを切っている感覚を出す
      camUp.copy(camFrame.u).addScaledVector(camFrame.r, car.tilt * (tilt.active ? 0.13 : 0.05)).normalize();
      camera.up.copy(camUp);
      camera.lookAt(lookAt);
      targetFov = 70 + speedRatio * 10 + (boosting ? 5 : 0);
    }
    if (Math.abs(targetFov - camState.fov) > 0.05) {
      camState.fov += (targetFov - camState.fov) * 0.08;
      camera.fov = camState.fov;
      camera.updateProjectionMatrix();
    }

    // 背景を追従させる
    const cp = camera.position;
    sky.position.copy(cp);
    skyline.position.set(cp.x, cp.y - 300, cp.z);
    sunSprite.position.set(cp.x, cp.y + 90, cp.z - 4700);
    groundPlane.position.set(cp.x, GROUND_Y - 0.5, cp.z);
    grid.position.set(Math.round(cp.x / 80) * 80, GROUND_Y, Math.round(cp.z / 80) * 80);
    // 影を落とす範囲は自機の周り（太陽は前方上空。影は手前側に伸びる）
    const hp = hero.root.position;
    sunLight.position.set(hp.x + 160, hp.y + 420, hp.z - 520);
    sunLight.target.position.set(hp.x, hp.y, hp.z - 40);
    rimLight.position.set(cp.x - 150, cp.y + 160, cp.z + 600);
    rimLight.target.position.copy(cp);

    // 雷（STORM HIGHWAY）
    if (course.theme.lightning && now > lightningUntil + 1500 && Math.random() < 0.006) lightningUntil = now + 160;
    const flashing = now < lightningUntil;
    hemiLight.intensity = flashing ? 2.4 : 0.8;
    scene.fog.color.setHex(flashing ? 0x7aa7c7 : course.theme.fog);

    if (composer && useBloom) composer.render();
    else renderer.render(scene, camera);

    // 2Dオーバーレイ（火花・スピード線・ビネット）
    heroScreen.copy(hero.root.position).addScaledVector(camFrame.u, 3).project(camera);
    const sx = (heroScreen.x + 1) / 2 * W;
    const sy = (1 - heroScreen.y) / 2 * H;
    drawOverlay(sx - W / 2, sy - (H - 76), now);
  };

  window.setCourse3D(course);
  window.setGhostMachine(ghostData ? ghostData.machine : null);
  window.setRenderQuality(raceOptions.quality);
})();
