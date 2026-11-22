// @ts-check
// コース切り替えとセットアップ画面（モード → コース → マシン）
// ※ ファイルは index.html に書いた順に読み込まれ、変数や関数はファイル間で共有される
// ===== コース切り替え =====
// 選べるコース = 収録コース4つ + コースエディタで作ったコース
function courseList() {
  return customCourse ? [...COURSES, customCourse] : COURSES;
}
function applyCourse(index) {
  course = courseList()[index] || COURSES[0];
  LAP_DISTANCE = course.lap;
  TOTAL_DISTANCE = LAP_DISTANCE * TOTAL_LAPS;
  TRACK_ZONES = course.zones;
  ghostData = loadJSON(`fzx-ghost-${course.id}`, null);
  buildMinimap();
  if (window.setCourse3D) window.setCourse3D(course);
  if (window.setGhostMachine) window.setGhostMachine(ghostData ? ghostData.machine : null);
}

// ===== セットアップ画面（モード・コース・マシン選択） =====
const wrapEl = document.getElementById('wrap');
const selectOverlay = document.getElementById('selectOverlay');
const machineCards = document.getElementById('machineCards');
const courseCards = document.getElementById('courseCards');
const modePills = document.getElementById('modePills');
MODES.forEach((mode, index) => {
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'mode-pill';
  pill.textContent = mode.name;
  pill.addEventListener('click', () => {
    selectedMode = index;
    playCue('ui');
    updateSetupUI();
  });
  modePills.appendChild(pill);
});
function renderCourseCards() {
  courseCards.innerHTML = '';
  courseList().forEach((courseDef, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'course-card';
    card.style.setProperty('--cc', courseDef.accent);
    card.addEventListener('click', () => {
      if (currentMode() === 'gp') return;
      selectedCourse = index;
      playCue('ui');
      updateSetupUI();
    });
    courseCards.appendChild(card);
  });
}
MACHINES.forEach((machineDef, index) => {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'machine-card';
  card.style.setProperty('--mc', machineDef.color);
  card.innerHTML = `<div class="mc-type">${machineDef.type}</div><div class="mc-name">${machineDef.name}</div>`
    + Object.keys(STAT_LABELS).map(key => `<div class="mc-stat"><span>${STAT_LABELS[key]}</span><i>${
      Array.from({ length: 5 }, (_, i) => `<b class="${i < machineDef.stats[key] ? 'on' : ''}"></b>`).join('')
    }</i></div>`).join('');
  card.addEventListener('click', () => selectMachine(index));
  machineCards.appendChild(card);
});
function selectMachine(index) {
  const next = (index + MACHINES.length) % MACHINES.length;
  const changed = next !== selectedMachine;
  selectedMachine = next;
  if (changed && window.setHeroMachine) window.setHeroMachine(effectiveMachine());
  if (changed) playCue('ui');
  updateSetupUI();
  if (changed) renderGarage();
}
// ステップ式: 0=モード → 1=コース → 2=マシン → START（グランプリはコースが決まっているのでコースを飛ばす）
function setFocusRow(row) {
  focusRow = clamp(row, 0, 2);
  if (focusRow === 1 && currentMode() === 'gp') focusRow = row > 1 ? 2 : (row < 1 ? 0 : 2);
  setTab('race');
  updateSetupUI();
}
function nextStep() {
  playCue('ui');
  if (focusRow >= 2) {
    startFromSetup();
    return;
  }
  setFocusRow(focusRow === 0 && currentMode() === 'gp' ? 2 : focusRow + 1);
}
function prevStep() {
  playCue('ui');
  if (activeTab !== 'race') {
    setTab('race');
    updateSetupUI();
    return;
  }
  setFocusRow(focusRow === 2 && currentMode() === 'gp' ? 0 : focusRow - 1);
}
function changeSetup(delta) {
  if (focusRow === 0) selectedMode = (selectedMode + delta + MODES.length) % MODES.length;
  const count = courseList().length;
  if (focusRow === 1 && currentMode() !== 'gp') selectedCourse = (selectedCourse + delta + count) % count;
  if (focusRow === 2) {
    selectMachine(selectedMachine + delta);
    return;
  }
  playCue('ui');
  updateSetupUI();
}
function updateSetupUI() {
  const gpMode = currentMode() === 'gp';
  selectOverlay.querySelectorAll('.setup-row').forEach((row, i) => row.classList.toggle('focus', i === focusRow));
  // 上部のステップ表示と、下部の「戻る / 次へ」ボタン
  document.querySelectorAll('#stepBar button').forEach((button, i) => {
    button.classList.toggle('active', activeTab === 'race' && i === focusRow);
    button.classList.toggle('done', i < focusRow);
    button.classList.toggle('skip', i === 1 && gpMode);
  });
  const onRace = activeTab === 'race';
  document.getElementById('backBtn').hidden = onRace && focusRow === 0;
  document.getElementById('backBtn').textContent = onRace ? '◀ 戻る' : '◀ 選択に戻る';
  const startBtn = document.getElementById('startBtn');
  startBtn.hidden = !onRace;
  startBtn.textContent = focusRow === 2 ? 'START ▶' : '次へ ▶';
  startBtn.classList.toggle('go', focusRow === 2);
  modePills.querySelectorAll('.mode-pill').forEach((pill, i) => pill.classList.toggle('active', i === selectedMode));
  const list = courseList();
  if (courseCards.children.length !== list.length) renderCourseCards();
  if (selectedCourse >= list.length) selectedCourse = 0;
  /** @type {NodeListOf<HTMLElement>} */ (courseCards.querySelectorAll('.course-card')).forEach((card, i) => {
    const courseDef = list[i];
    const rec = courseRecord(courseDef.id);
    const custom = Boolean(courseDef.custom);
    card.hidden = gpMode && custom;   // グランプリは収録コースのみ
    card.innerHTML = `<div class="cc-name">${gpMode ? `ROUND ${i + 1} · ` : ''}${custom ? '★ ' : ''}${escapeHtml(courseDef.name)}</div>
      <div class="cc-feat">${escapeHtml(courseDef.features)}</div>
      <div class="cc-rec">BEST ${rec ? formatTime(rec.best) : '--:--.--'}</div>`;
    card.classList.toggle('active', (gpMode && !custom) || (!gpMode && i === selectedCourse));
    card.classList.toggle('locked', gpMode);
  });
  machineCards.querySelectorAll('.machine-card').forEach((card, i) => card.classList.toggle('active', i === selectedMachine));
  const previewIndex = gpMode ? 0 : selectedCourse;
  if (course !== list[previewIndex]) applyCourse(previewIndex);
  // 説明文は今のステップの内容だけ出す
  const machineDef = currentMachine();
  const courseDef = list[previewIndex];
  let desc = '';
  if (activeTab !== 'race') desc = '';
  else if (focusRow === 0) desc = `<b>${MODES[selectedMode].name}</b>: ${MODES[selectedMode].desc}`;
  else if (focusRow === 1) desc = `<b>${escapeHtml(courseDef.name)}</b>: ${escapeHtml(courseDef.features)}`;
  else desc = `<b>${machineDef.name}</b>（${machineDef.type}）: ${machineDef.desc}`;
  document.getElementById('machineDesc').innerHTML = desc;
  updatePointsBadges();
}
function openSetup() {
  focusRow = 0;
  selectingMachine = true;
  resetRace();
  selectOverlay.hidden = false;
  wrapEl.classList.add('selecting');
  updateSetupUI();
}
function startFromSetup() {
  // 傾き操作はボタンを押した操作の中でセンサーの許可を求める必要がある（iPhone）
  if (raceOptions.control === 'tilt') enableTilt();
  TOTAL_LAPS = raceOptions.laps;
  raceMode = currentMode();
  if (raceMode === 'gp') {
    gp.active = true;
    gp.index = 0;
    gp.points = {};
    applyCourse(0);
  } else {
    gp.active = false;
    applyCourse(selectedCourse);
  }
  selectingMachine = false;
  selectOverlay.hidden = true;
  wrapEl.classList.remove('selecting');
  beginRace();
  playCue('ok');
}
document.getElementById('startBtn').addEventListener('click', nextStep);
document.getElementById('backBtn').addEventListener('click', prevStep);
document.querySelectorAll('#stepBar button').forEach((button, i) => button.addEventListener('click', () => {
  playCue('ui');
  setFocusRow(i);
}));
document.getElementById('optionsBtn').addEventListener('click', () => {
  playCue('ui');
  setTab(activeTab === 'options' ? 'race' : 'options');
  updateSetupUI();
});
document.getElementById('openGarage').addEventListener('click', () => { playCue('ui'); setTab('garage'); updateSetupUI(); });
document.getElementById('openEditor').addEventListener('click', () => { playCue('ui'); setTab('editor'); updateSetupUI(); });
