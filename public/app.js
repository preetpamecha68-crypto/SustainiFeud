'use strict';
const socket = io({ reconnection: true, reconnectionAttempts: 8, reconnectionDelay: 500 });
const app = document.getElementById('app');
const toast = document.getElementById('toast');
let mode = null, roomCode = null, playerId = null, room = null;
let submittedLocal = false, buzzedLocal = false, hostQuestionBank = [], hostRoundQuestion = null, seenResultKey = null, hostToken = null, playerToken = null, displayName = null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const getHostQuestion = () => hostRoundQuestion || hostQuestionBank.find(q => q.id === Number(room?.question?.id));
function notify(message) {
  toast.textContent = message; toast.classList.add('show'); clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 3000);
}
function shell(content, cls = '') { app.innerHTML = `<div class="page ${cls}">${content}</div>`; }
function logo() { return `<div class="brand"><span class="brand-mark">S</span><span>SUSTAINI<span class="brand-dash">·</span>FEUD</span></div>`; }
function restoreSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('sf-active') || 'null');
    if (!saved || !['host', 'player'].includes(saved.mode) || typeof saved.roomCode !== 'string') return false;
    mode = saved.mode; roomCode = saved.roomCode; hostToken = saved.mode === 'host' ? saved.token : null;
    playerToken = saved.mode === 'player' ? saved.token : null; displayName = saved.name || null;
    shell(`<section class="center-stage"><div class="entry-card reconnect-card">${logo()}<div class="eyebrow"><span class="eyebrow-line"></span> RESTORING YOUR SESSION</div><h2>Getting you<br>back in.</h2><p>Reconnecting to room <strong>${esc(roomCode)}</strong>. Keep this tab open for a moment.</p><div class="waiting-pill"><span class="live-dot"></span> RECONNECTING…</div></div></section>`);
    return true;
  } catch { return false; }
}
function home() {
  if (roomCode) { sessionStorage.removeItem(`sf-host-${roomCode}`); sessionStorage.removeItem(`sf-player-${roomCode}`); sessionStorage.removeItem(`sf-name-${roomCode}`); sessionStorage.removeItem('sf-active'); }
  mode = null; room = null; roomCode = null; playerId = null; submittedLocal = false; buzzedLocal = false; hostQuestionBank = []; hostRoundQuestion = null; seenResultKey = null; hostToken = null; playerToken = null; displayName = null;
  shell(`<section class="home-stage"><nav class="top-line"><span class="event-chip"><i></i> SUSTAINICITY 2026</span><span>THE LIVE SUSTAINABILITY SHOWDOWN</span></nav>
    <div class="hero-grid"><div class="hero-copy"><div class="eyebrow"><span class="eyebrow-line"></span> THINK GREEN. PLAY BOLD.</div>${logo()}<h1>THE PLANET<br>IS ON THE <span>BOARD.</span></h1><p class="home-copy">A fast, loud, sustainability showdown. Join the room, beat the buzzer, and put your knowledge to the test.</p>
      <div class="home-actions"><button class="game-btn primary" type="button" onclick="hostGame()">HOST A GAME <b>↗</b></button><button class="game-btn secondary" type="button" onclick="showJoin()">JOIN THE GAME <b>→</b></button></div>
      <div class="hero-foot"><span><b>40</b> PLAYER CAPACITY</span><span><b>33</b> RANDOM QUESTIONS</span><span><b>LIVE</b> MULTIPLAYER</span></div></div>
      <div class="hero-art" aria-hidden="true"><div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div><div class="planet"><div class="planet-land land-one"></div><div class="planet-land land-two"></div><div class="planet-land land-three"></div><div class="planet-shine"></div></div><div class="float-card float-top"><span class="float-icon">✳</span><div><small>YOUR MISSION</small><strong>Think sustainably</strong></div></div><div class="float-card float-bottom"><span class="live-dot"></span><div><small>PLAYERS CAN JOIN</small><strong>Up to 40 people</strong></div></div><div class="art-star star-one">✦</div><div class="art-star star-two">✧</div></div></div>
    <div class="bottom-bar"><span>ONE ROOM. BIG ENERGY.</span><span>BUZZ FAST · THINK SMART · PLAY FAIR</span></div></section>`);
}
function showJoin() {
  shell(`<section class="entry-stage"><div class="entry-card"><button class="icon-back" type="button" onclick="home()" aria-label="Back">←</button>${logo()}<div class="eyebrow"><span class="eyebrow-line"></span> PLAYER CHECK-IN</div><h1>GET IN<br><span>THE GAME.</span></h1><p>Enter the 5-character room code from the big screen and choose the name everyone will see.</p><form onsubmit="joinGame(event)"><label for="join-code">ROOM CODE</label><input id="join-code" maxlength="5" minlength="5" autocomplete="off" autocapitalize="characters" placeholder="A7K92" required /><label for="join-name">YOUR DISPLAY NAME</label><input id="join-name" maxlength="18" autocomplete="name" placeholder="Your name" required /><button class="game-btn primary full" type="submit">JOIN THE SHOWDOWN <b>↗</b></button></form><div class="entry-note"><span class="live-dot"></span> Up to 40 participants · No app download needed</div></div></section>`);
  const code = document.getElementById('join-code');
  code?.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
  code?.focus();
}
function hostGame() { socket.emit('host:create'); }
function joinGame(event) {
  event.preventDefault(); roomCode = document.getElementById('join-code').value.trim().toUpperCase();
  const name = document.getElementById('join-name').value.trim(); displayName = name; socket.emit('player:join', { code: roomCode, name });
}
function copyRoomCode() {
  if (!roomCode) return;
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(roomCode).then(() => notify('Room code copied!')).catch(() => notify(`Room code: ${roomCode}`));
  else notify(`Room code: ${roomCode}`);
}
function startGame() { if ((room?.players?.length || 0) < 2) return notify('At least 2 players need to join first.'); socket.emit('host:start', { code: roomCode }); }
function nextQuestion() { socket.emit('host:next', { code: roomCode }); }
function resetGame() { if (confirm('Reset all scores and return everyone to the lobby?')) socket.emit('host:reset', { code: roomCode }); }
function award(index) { socket.emit('host:resolve', { code: roomCode, answerIndex: index }); }
function wrong() { socket.emit('host:wrong', { code: roomCode }); }
function playerInitial(name) { return esc((name || '?').trim().charAt(0).toUpperCase()); }
function roster(players, compact = false) {
  if (!players.length) return `<div class="empty-roster"><div class="empty-icon">✳</div><strong>You're early. We like that.</strong><span>Players will appear here as they join.</span></div>`;
  return `<div class="roster-list ${compact ? 'compact' : ''}">${players.map((p, i) => `<div class="roster-item"><span class="player-number">${String(i + 1).padStart(2, '0')}</span><span class="player-avatar avatar-${i % 6}">${playerInitial(p.name)}</span><span class="roster-name">${esc(p.name)}</span><span class="online-dot" title="Connected"></span></div>`).join('')}</div>`;
}
function hostLobby() {
  const players = room?.players || [];
  shell(`<section class="host-shell"><header class="game-header">${logo()}<div class="header-meta"><span class="live-badge"><i></i> LIVE ROOM</span><button class="room-pill" type="button" onclick="copyRoomCode()"><span>ROOM CODE</span><strong>${esc(roomCode)}</strong><b>⧉</b></button></div></header>
    <div class="lobby-hero"><div class="lobby-intro"><div class="eyebrow"><span class="eyebrow-line"></span> HOST CONTROL CENTER</div><h1>LET'S MAKE<br><span>SOME IMPACT.</span></h1><p>Your players join below. Once at least two people are in, launch the show. Questions are picked and shuffled automatically—no setup, no scrolling, just play.</p><div class="lobby-actions"><button class="game-btn primary start-game" type="button" onclick="startGame()" ${players.length >= 2 ? '' : 'disabled'}>START SHOWDOWN <b>↗</b></button><span class="minimum-note">${players.length < 2 ? `Need ${2 - players.length} more player${players.length === 1 ? '' : 's'} to start` : 'Ready when you are · Questions shuffle automatically'}</span></div></div>
      <div class="room-code-card"><div class="room-card-top"><span>YOUR ROOM IS OPEN</span><span class="live-dot"></span></div><div class="room-code-display">${esc(roomCode)}</div><p>Have everyone open this game on their phone and enter the code.</p><button class="copy-btn" type="button" onclick="copyRoomCode()">⧉ &nbsp; COPY ROOM CODE</button><div class="capacity-meter"><div><span>PARTICIPANTS</span><strong>${players.length}<small> / 40</small></strong></div><div class="capacity-track"><span style="width:${Math.min(100, players.length / 40 * 100)}%"></span></div></div></div></div>
    <div class="lobby-roster-card"><div class="section-heading"><div><span class="eyebrow">THE LINEUP</span><h2>Players are rolling in<span>.</span></h2></div><div class="roster-count"><strong>${players.length}</strong><span>OF 40 PLAYERS</span></div></div>${roster(players)}<div class="roster-footer"><span><i class="live-dot"></i> LIVE UPDATES ON</span><span>${players.length >= 40 ? 'ROOM FULL — READY TO PLAY' : `${40 - players.length} spots available`}</span></div></div>
  </section>`);
}
function answerBoardHost() {
  const q = getHostQuestion(); const answers = q?.answers || [];
  return `<div class="answer-board">${answers.map((answer, i) => {
    const revealed = room.revealed.includes(i); const selectable = room.status === 'host-review' && !!room.submittedAnswer && !revealed;
    return `<button class="answer-tile ${revealed ? 'revealed' : ''} ${selectable ? 'selectable' : ''}" type="button" ${selectable ? '' : 'disabled'} onclick="award(${i})"><span class="tile-index">${String(i + 1).padStart(2, '0')}</span><span class="tile-answer">${revealed ? esc(answer.text) : '••••••••••••'}</span><span class="tile-points">${Number(answer.points)}</span></button>`;
  }).join('')}</div>`;
}
function hostGameScreen() {
  const players = [...(room.players || [])].sort((a, b) => b.score - a.score);
  const answerer = room.players.find(p => p.id === room.answererId);
  const roundOver = room.status === 'ended', reviewing = room.status === 'host-review', answering = room.status === 'answering';
  const title = roundOver ? 'ROUND COMPLETE' : reviewing ? 'HOST DECISION' : answering ? 'ANSWER IN PROGRESS' : 'BUZZER IS LIVE';
  const copy = roundOver ? `${room.winnerName ? `${room.winnerName} got it!` : 'No more eligible players.'} Hit next question for a fresh random prompt.` : reviewing ? 'Choose the matching board answer to award points, or mark the response wrong.' : answering ? 'Listen to the answer, then make your call from the host screen.' : `${eligibleCount()} eligible players are ready to buzz. First tap wins the turn.`;
  shell(`<section class="host-shell game-live-shell"><header class="game-header">${logo()}<div class="header-meta"><span class="live-badge"><i></i> LIVE GAME</span><div class="room-pill"><span>ROOM</span><strong>${esc(roomCode)}</strong></div><button class="text-action" type="button" onclick="resetGame()">RESET GAME</button></div></header>
    <div class="game-topline"><span>ROUND <b>${String(room.roundNumber).padStart(2, '0')}</b> <i> / ${room.totalQuestions || 33}</i></span><span class="auto-tag">✦ AUTO-SHUFFLED QUESTION</span></div>
    <div class="question-card"><div class="question-label"><span class="question-orb">✳</span> THE QUESTION</div><h1>${esc(room.question?.question || 'Question loading…')}</h1><div class="question-card-footer"><span>${room.revealed.length} / 6 ANSWERS REVEALED</span><span>FIRST CORRECT ANSWER WINS THE ROUND</span></div></div>
    <div class="show-layout"><main class="show-main">${answerBoardHost()}<div class="show-status-card"><div class="status-heading"><span class="status-pip ${roundOver ? 'done' : reviewing ? 'review' : ''}"></span><div><span class="small-label">${title}</span><strong>${answerer ? esc(answerer.name) : roundOver ? (room.winnerName ? `${esc(room.winnerName)} WINS` : 'ROUND OVER') : 'ALL PLAYERS READY'}</strong></div></div><p>${copy}</p></div>
      <div class="contestant-panel"><div class="answer-window"><span class="small-label">LOCKED-IN ANSWER</span><div class="live-answer">${room.submittedAnswer ? `“${esc(room.submittedAnswer)}”` : answering ? '<span>Player is thinking…</span>' : '<span>No answer submitted yet</span>'}</div></div><div class="host-controls"><button class="game-btn danger" type="button" onclick="wrong()" ${reviewing ? '' : 'disabled'}>✕ &nbsp; MARK WRONG <small>−10 PTS</small></button><button class="game-btn primary" type="button" onclick="nextQuestion()" ${roundOver ? '' : 'disabled'}>${roundOver ? 'NEXT RANDOM QUESTION' : 'WAITING FOR ROUND END'} <b>→</b></button></div><p class="host-tip">Click an unrevealed answer tile to award its points. Scores cannot go below zero.</p></div></main>
      <aside class="scoreboard-card"><div class="scoreboard-heading"><div><span class="eyebrow">THE LEADERBOARD</span><h2>Scoreboard<span>.</span></h2></div><span class="players-count">${room.players.length}<small> / 40</small></span></div><div class="score-list">${players.map((p, i) => `<div class="score-line ${p.id === room.answererId ? 'current' : ''}"><span class="score-rank ${i < 3 ? 'top-rank' : ''}">${String(i + 1).padStart(2, '0')}</span><span class="score-avatar avatar-${i % 6}">${playerInitial(p.name)}</span><strong>${esc(p.name)}</strong><b>${p.score}</b></div>`).join('')}</div><div class="scoreboard-footer"><span><i class="live-dot"></i> SCORES UPDATE LIVE</span><span>PTS</span></div></aside></div>
  </section>`);
}
function eligibleCount() { return (room?.players || []).filter(p => p.connected && !(room.triedPlayerIds || []).includes(p.id)).length; }
function showWrongOverlay(name, points, anotherChance) {
  const overlay = document.createElement('div'); overlay.className = 'result-overlay wrong-overlay';
  overlay.innerHTML = `<div class="result-card"><div class="result-icon">×</div><div class="result-word">NOT QUITE.</div><div class="result-name">${esc(name)}</div><div class="result-points">${points} PTS</div><div class="result-next">${anotherChance ? 'BUZZER REOPENED — SOMEONE ELSE, GO!' : 'ROUND COMPLETE'}</div></div>`;
  document.body.appendChild(overlay); setTimeout(() => overlay.remove(), 1400);
}
function showCorrectOverlay(name, points) {
  const overlay = document.createElement('div'); overlay.className = 'result-overlay correct-overlay';
  overlay.innerHTML = `<div class="result-card"><div class="result-icon">✓</div><div class="result-word">NAILED IT!</div><div class="result-name">${esc(name)}</div><div class="result-points">+${points} PTS</div><div class="result-next">ROUND WON</div></div>`;
  document.body.appendChild(overlay); setTimeout(() => overlay.remove(), 1500);
}
function playerView() {
  const me = room?.players?.find(p => p.id === playerId); const status = room?.status;
  const buzzOpen = status === 'buzzing'; const iWonBuzz = room?.answererId === playerId;
  const tried = (room?.triedPlayerIds || []).includes(playerId);
  const waitingForOther = ['answering', 'host-review'].includes(status) && !iWonBuzz;
  const ended = status === 'ended'; const hostDisconnected = status === 'host-disconnected'; let body;
  if (hostDisconnected) body = `<div class="phone-status"><span class="status-pip done"></span> CONNECTION PAUSED</div><h1>Host has<br><span>disconnected.</span></h1><p>The host connection ended. Please wait while the room closes, or return home.</p><button class="game-btn secondary full" type="button" onclick="home()">BACK TO HOME</button>`;
  else if (ended) body = `<div class="phone-status"><span class="status-pip done"></span> ROUND COMPLETE</div><h1>${room.winnerId === playerId ? 'YOU GOT IT!' : `NICE PLAY, ${esc(me?.name || 'PLAYER')}.`}</h1><div class="mobile-final-score"><span>YOUR TOTAL SCORE</span><strong>${me?.score ?? 0}</strong></div><p>${room.winnerName ? `${esc(room.winnerName)} won this round.` : 'All available turns have been used.'} Stay ready for the next shuffled question.</p><div class="waiting-pill"><span class="live-dot"></span> WAITING FOR NEXT ROUND</div>`;
  else if (iWonBuzz && status === 'answering') body = `<div class="buzz-win-pill">✦ YOU GOT THE BUZZ</div><div class="phone-status">QUESTION ${String(room.roundNumber).padStart(2, '0')}</div><h1 class="phone-question">${esc(room.question.question)}</h1><p>Type your best answer. The host will decide whether it matches the board.</p><form onsubmit="submitAnswer(event)" class="phone-form"><input id="player-answer" maxlength="100" autocomplete="off" placeholder="Type your answer…" ${submittedLocal ? 'disabled' : ''} required /><button class="game-btn primary full" type="submit" ${submittedLocal ? 'disabled' : ''}>${submittedLocal ? 'ANSWER LOCKED ✓' : 'LOCK IT IN ↗'}</button></form><div class="phone-score"><span>YOUR SCORE</span><strong>${me?.score ?? 0}</strong></div>`;
  else if (buzzOpen && !tried) body = `<div class="buzzer-ring"><span>BUZZ!</span></div><div class="phone-status"><span class="status-pip"></span> BUZZER OPEN · ROUND ${String(room.roundNumber).padStart(2, '0')}</div><h1>THINK FAST.<br><span>BUZZ FIRST.</span></h1><p>${esc(room.question?.question || 'Listen for the question on the main screen.')}</p><button class="game-btn buzzer-btn" type="button" onclick="buzz()" ${buzzedLocal ? 'disabled' : ''}>${buzzedLocal ? 'BUZZ SENT ✓' : 'BUZZ IN NOW!'}</button><div class="phone-score"><span>YOUR SCORE</span><strong>${me?.score ?? 0}</strong></div>`;
  else if (waitingForOther) body = `<div class="waiting-pulse"><span></span></div><div class="phone-status">${status === 'host-review' ? 'ANSWER UNDER REVIEW' : 'BUZZER LOCKED'}</div><h1>${room.answererId ? `${esc(room.players.find(p => p.id === room.answererId)?.name || 'A player')} is up.` : 'Hold that thought.'}</h1><p>${status === 'host-review' ? 'The host is checking the answer. If it is wrong, the buzzer opens for everyone who has not tried yet.' : 'Someone got the buzzer first. Stay sharp—if their answer is wrong, you may get your shot.'}</p><div class="phone-score"><span>YOUR SCORE</span><strong>${me?.score ?? 0}</strong></div>`;
  else if (tried) body = `<div class="waiting-pulse"><span></span></div><div class="phone-status">TURN USED</div><h1>Good effort,<br><span>${esc(me?.name || 'player')}.</span></h1><p>You have already had a turn this question. Cheer on the others and get ready for the next random round.</p><div class="phone-score"><span>YOUR SCORE</span><strong>${me?.score ?? 0}</strong></div>`;
  else body = `<div class="waiting-pulse"><span></span></div><div class="phone-status">${status === 'lobby' ? 'YOU ARE IN' : 'STAND BY'}</div><h1>You're on<br><span>the team.</span></h1><p>${status === 'lobby' ? 'You are checked in. The host will start the showdown once everyone is ready.' : 'Watch the big screen. The next question will appear automatically.'}</p><div class="phone-score"><span>YOUR SCORE</span><strong>${me?.score ?? 0}</strong></div>`;
  shell(`<section class="phone-stage"><div class="phone-card"><div class="phone-card-head">${logo()}<span class="phone-room">${esc(roomCode)}</span></div><div class="phone-body">${body}</div><div class="phone-foot"><span><i class="live-dot"></i> SUSTAINICITY LIVE</span><span>PLAYER ${String((room?.players || []).findIndex(p => p.id === playerId) + 1).padStart(2, '0')}</span></div></div></section>`);
  if (iWonBuzz && status === 'answering' && !submittedLocal) setTimeout(() => document.getElementById('player-answer')?.focus(), 0);
}
function buzz() { if (buzzedLocal || room?.status !== 'buzzing') return; buzzedLocal = true; socket.emit('player:buzz', { code: roomCode }); playerView(); }
function submitAnswer(event) { event.preventDefault(); if (submittedLocal) return; const input = document.getElementById('player-answer'); const answer = input?.value.trim(); if (!answer) return; submittedLocal = true; socket.emit('player:submit', { code: roomCode, answer }); playerView(); }
function render() {
  if (!mode || !room) return;
  if (mode === 'host') { if (room.status === 'lobby') hostLobby(); else if (room.status === 'host-disconnected') hostLobby(); else hostGameScreen(); }
  else playerView();
}
socket.on('host:created', data => { mode = 'host'; roomCode = data.code; hostToken = data.hostToken || hostToken; if (hostToken) sessionStorage.setItem(`sf-host-${roomCode}`, hostToken); if (hostToken) sessionStorage.setItem('sf-active', JSON.stringify({ mode: 'host', roomCode, token: hostToken })); hostQuestionBank = data.questions || hostQuestionBank; hostRoundQuestion = null; notify(data.reconnected ? 'Host connection restored.' : 'Room created. Share the code with up to 40 players.'); });
socket.on('host:round', data => { hostRoundQuestion = data.question || null; });
socket.on('player:joined', data => { mode = 'player'; roomCode = data.code; playerId = data.playerId; playerToken = data.token || playerToken; if (playerToken) sessionStorage.setItem(`sf-player-${roomCode}`, playerToken); if (displayName) sessionStorage.setItem(`sf-name-${roomCode}`, displayName); if (playerToken) sessionStorage.setItem('sf-active', JSON.stringify({ mode: 'player', roomCode, token: playerToken, name: displayName || '' })); submittedLocal = false; buzzedLocal = false; notify(data.reconnected ? 'Connection restored—you’re back in.' : 'You’re in! Good luck.'); });
socket.on('room:update', data => {
  const oldStatus = room?.status, oldAnswerer = room?.answererId; room = data;
  if (mode === 'host' && room.question) hostRoundQuestion = hostQuestionBank.find(q => q.id === Number(room.question.id)) || hostRoundQuestion;
  if (mode === 'player') {
    if (room.status === 'buzzing' && oldStatus !== 'buzzing') { buzzedLocal = false; submittedLocal = false; }
    if (room.answererId !== oldAnswerer && room.answererId === playerId) submittedLocal = false;
    const result = room.lastResult; const key = result ? `${result.type}-${result.playerId}-${result.points}-${room.roundNumber}-${room.status}` : null;
    if (result && key !== seenResultKey && result.type === 'wrong' && result.playerId === playerId) showWrongOverlay(result.name, result.points, room.status === 'buzzing');
    if (result && key !== seenResultKey && result.type === 'correct' && result.playerId === playerId) showCorrectOverlay(result.name, result.points);
    seenResultKey = key;
  }
  render();
});
socket.on('host:disconnected', () => { if (mode === 'player') { room = { ...(room || {}), status: 'host-disconnected' }; playerView(); } });
socket.on('room:closed', data => { notify(data?.message || 'Room closed.'); setTimeout(home, 1800); });
socket.on('game:error', data => { notify(data.message); if (mode === 'player' && /buzzer|turn|answer|already|slow down/i.test(data.message)) { if (room?.status !== 'answering') buzzedLocal = false; submittedLocal = false; playerView(); } });
socket.on('connect_error', () => notify('Connection issue. Checking the game server…'));
socket.on('disconnect', () => { if (mode === 'host' || mode === 'player') notify('Connection lost. Reconnecting…'); });
socket.on('connect', () => {
  if (!mode) { home(); return; }
  if (mode === 'host' && roomCode) { hostToken = hostToken || sessionStorage.getItem(`sf-host-${roomCode}`); if (hostToken) socket.emit('host:reconnect', { code: roomCode, token: hostToken }); }
  if (mode === 'player' && roomCode) { playerToken = playerToken || sessionStorage.getItem(`sf-player-${roomCode}`); displayName = displayName || sessionStorage.getItem(`sf-name-${roomCode}`); if (playerToken) socket.emit('player:reconnect', { code: roomCode, token: playerToken }); }
});
restoreSession() || home();
