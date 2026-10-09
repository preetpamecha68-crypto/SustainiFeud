'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const questions = require('./data/questions.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5, pingInterval: 25000, pingTimeout: 20000 });
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 40;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const HOST_GRACE_MS = 10 * 60 * 1000;
const rooms = new Map();
const BASE_POINTS = [50, 40, 30, 20, 10, 5];
const WRONG_PENALTY = 10;
const ANSWER_TIME_MS = 30 * 1000;
const HOST_REVIEW_TIME_MS = 30 * 1000;

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, questions: questions.length, maxPlayers: MAX_PLAYERS }));
app.get('/api/questions', (_req, res) => res.json(questions.map(q => ({ id: q.id, question: q.question }))));

function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from(crypto.randomBytes(5), b => alphabet[b % alphabet.length]).join('');
  } while (rooms.has(code));
  return code;
}
function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 18);
}
function cleanAnswer(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 100);
}
function isPayload(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function emitError(socket, message) { socket.emit('game:error', { message }); }
function getRoom(socket, code) {
  if (typeof code !== 'string' || !/^[A-Z0-9]{5}$/i.test(code)) { emitError(socket, 'Enter a valid 5-character room code.'); return null; }
  const room = rooms.get(code.toUpperCase());
  if (!room) emitError(socket, 'Room not found. Check the code and try again.');
  return room || null;
}
function cancelTimer(room) { if (room.cleanupTimer) clearTimeout(room.cleanupTimer); room.cleanupTimer = null; }
function clearTurnTimer(room) { if (room.turnTimer) clearTimeout(room.turnTimer); room.turnTimer = null; room.turnDeadline = null; }
function destroyRoom(room, message) {
  cancelTimer(room);
  clearTurnTimer(room);
  for (const entry of room.disconnectedPlayers?.values?.() || []) clearTimeout(entry.timer);
  if (message) io.to(room.code).emit('room:closed', { message });
  for (const p of room.players.values()) {
    const s = io.sockets.sockets.get(p.id);
    if (s) { s.leave(room.code); delete s.data.roomCode; delete s.data.role; }
  }
  const host = io.sockets.sockets.get(room.hostId);
  if (host) { host.leave(room.code); delete host.data.roomCode; delete host.data.role; }
  rooms.delete(room.code);
}
function scheduleCleanup(room, delay = ROOM_TTL_MS) {
  cancelTimer(room);
  room.cleanupTimer = setTimeout(() => destroyRoom(room, 'This room expired. Please create a new game.'), delay);
  room.cleanupTimer.unref?.();
}
function shuffledQuestionIds(excludeId = null) {
  const pool = questions.filter(q => q.id !== excludeId).map(q => q.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
function nextQuestion(room) {
  if (!room.questionBag.length) room.questionBag = shuffledQuestionIds(room.lastQuestionId);
  if (!room.questionBag.length) room.questionBag = shuffledQuestionIds();
  const id = room.questionBag.pop();
  return questions.find(q => q.id === id) || questions[crypto.randomInt(questions.length)];
}
function publicRoom(room) {
  return {
    code: room.code,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected })),
    status: room.status,
    question: room.question ? { id: room.question.id, question: room.question.question } : null,
    roundNumber: room.roundNumber,
    roundsPlayed: room.roundNumber,
    totalQuestions: questions.length,
    revealed: [...room.revealed],
    buzzWinnerId: room.buzzWinnerId,
    answererId: room.answererId,
    triedPlayerIds: [...room.triedPlayerIds],
    submittedAnswer: room.submittedAnswer,
    lastResult: room.lastResult,
    winnerId: room.winnerId,
    winnerName: room.winnerName,
    turnDeadline: room.turnDeadline || null,
    answerTimeLimitSeconds: ANSWER_TIME_MS / 1000
  };
}
function broadcast(room, refreshExpiry = true) {
  if (refreshExpiry && room.status !== 'host-disconnected') scheduleCleanup(room, ROOM_TTL_MS);
  io.to(room.code).emit('room:update', publicRoom(room));
}
function isHost(socket, room) { return room.hostId === socket.id && socket.data.role === 'host' && socket.data.roomCode === room.code; }
function isPlayer(socket, room) { return room.players.has(socket.id) && socket.data.role === 'player' && socket.data.roomCode === room.code; }
function resetRound(room, question) {
  clearTurnTimer(room);
  room.question = question;
  room.lastQuestionId = question.id;
  room.roundNumber += 1;
  room.status = 'buzzing';
  room.revealed = [];
  room.buzzWinnerId = null;
  room.answererId = null;
  room.triedPlayerIds = new Set();
  room.submittedAnswer = null;
  room.lastResult = null;
  room.winnerId = null;
  room.winnerName = null;
}
function endRound(room) {
  clearTurnTimer(room);
  room.status = 'ended';
  room.buzzWinnerId = null;
  room.answererId = null;
  room.submittedAnswer = null;
}
function eligiblePlayers(room) {
  return [...room.players.values()].filter(p => p.connected && !room.triedPlayerIds.has(p.id));
}
function reopenBuzzerOrEnd(room) {
  clearTurnTimer(room);
  room.buzzWinnerId = null;
  room.answererId = null;
  room.submittedAnswer = null;
  if (eligiblePlayers(room).length) room.status = 'buzzing';
  else endRound(room);
}
function markCurrentAnswerWrong(room, timedOut = false) {
  if (!room.answererId || !['answering', 'host-review'].includes(room.status)) return false;
  clearTurnTimer(room);
  const player = room.players.get(room.answererId);
  if (player) player.score = Math.max(0, player.score - WRONG_PENALTY);
  room.triedPlayerIds.add(room.answererId);
  room.lastResult = { type: 'wrong', playerId: room.answererId, name: player?.name || 'Player', points: -WRONG_PENALTY, timedOut };
  reopenBuzzerOrEnd(room);
  return true;
}
function startTurnTimer(room, delay, expectedStatus) {
  clearTurnTimer(room);
  const playerId = room.answererId;
  room.turnDeadline = Date.now() + delay;
  room.turnTimer = setTimeout(() => {
    if (!rooms.has(room.code) || room.answererId !== playerId || room.status !== expectedStatus) return;
    if (expectedStatus === 'answering') room.triedPlayerIds.add(playerId);
    if (markCurrentAnswerWrong(room, true)) broadcast(room);
  }, delay);
  room.turnTimer.unref?.();
}

io.on('connection', socket => {
  socket.data.lastEvents = new Map();

  // Lightweight event throttling to protect the live game from accidental tap-spam.
  socket.use(([event], next) => {
    const now = Date.now();
    const previous = socket.data.lastEvents.get(event) || 0;
    const minGap = event === 'player:buzz' ? 80 : 120;
    if (now - previous < minGap) return next(new Error('Please slow down and try again.'));
    socket.data.lastEvents.set(event, now);
    next();
  });

  socket.on('host:create', () => {
    if (socket.data.roomCode) {
      const old = rooms.get(socket.data.roomCode);
      if (old && isHost(socket, old)) destroyRoom(old, 'The host started a new room.');
      else if (old && old.players.has(socket.id)) old.players.delete(socket.id);
    }
    const code = roomCode();
    const room = {
      code, hostId: socket.id, hostToken: crypto.randomBytes(24).toString('hex'), players: new Map(), disconnectedPlayers: new Map(), status: 'lobby', question: null,
      revealed: [], buzzWinnerId: null, answererId: null, triedPlayerIds: new Set(),
      submittedAnswer: null, lastResult: null, winnerId: null, winnerName: null,
      roundNumber: 0, questionBag: shuffledQuestionIds(), lastQuestionId: null, cleanupTimer: null, turnTimer: null, turnDeadline: null
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.role = 'host';
    socket.data.roomCode = code;
    scheduleCleanup(room);
    socket.emit('host:created', { code, questions, hostToken: room.hostToken, reconnected: false });
    broadcast(room);
  });

  socket.on('player:join', payload => {
    if (!isPayload(payload)) return emitError(socket, 'Invalid join request.');
    const room = getRoom(socket, payload.code);
    if (!room) return;
    if (socket.data.roomCode) return emitError(socket, 'You are already connected to a room. Refresh before joining another.');
    if (room.status !== 'lobby') return emitError(socket, 'This game has already started. Ask the host to create a new room.');
    if (room.players.size >= MAX_PLAYERS) return emitError(socket, `This game is full (${MAX_PLAYERS} participants).`);
    const name = cleanName(payload.name);
    if (!name) return emitError(socket, 'Please enter a valid name.');
    if ([...room.players.values()].some(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase()) || [...room.disconnectedPlayers.values()].some(entry => entry.player.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return emitError(socket, 'That name is already in the room. Please add an initial or nickname.');
    const player = { id: socket.id, name, score: 0, connected: true, token: crypto.randomBytes(24).toString('hex') };
    room.players.set(socket.id, player);
    socket.join(room.code);
    socket.data.role = 'player';
    socket.data.roomCode = room.code;
    cancelTimer(room);
    scheduleCleanup(room);
    socket.emit('player:joined', { code: room.code, playerId: socket.id, token: player.token, reconnected: false });
    broadcast(room);
  });

  socket.on('host:reconnect', payload => {
    if (!isPayload(payload) || typeof payload.token !== 'string') return emitError(socket, 'Invalid host recovery request.');
    const room = getRoom(socket, payload.code);
    if (!room || room.hostToken !== payload.token || room.status !== 'host-disconnected') return emitError(socket, 'This host session cannot be recovered.');
    room.hostId = socket.id;
    socket.join(room.code);
    socket.data.role = 'host'; socket.data.roomCode = room.code;
    room.status = room.statusBeforeHostDisconnect || 'lobby';
    delete room.statusBeforeHostDisconnect;
    cancelTimer(room); scheduleCleanup(room, ROOM_TTL_MS);
    if (room.status === 'answering' || room.status === 'host-review') {
      const remaining = room.pausedTurnRemainingMs || Math.max(1, (room.turnDeadline || Date.now()) - Date.now());
      delete room.pausedTurnRemainingMs;
      startTurnTimer(room, remaining, room.status);
    }
    socket.emit('host:created', { code: room.code, questions, hostToken: room.hostToken, reconnected: true });
    if (room.question) socket.emit('host:round', { question: room.question });
    broadcast(room);
  });

  socket.on('player:reconnect', payload => {
    if (!isPayload(payload) || typeof payload.token !== 'string' || !/^[a-f0-9]{48}$/i.test(payload.token)) return emitError(socket, 'Invalid player recovery request.');
    const room = getRoom(socket, payload.code);
    if (!room || room.status === 'host-disconnected') return emitError(socket, 'The host must reconnect before players can rejoin.');
    if (socket.data.roomCode) return emitError(socket, 'This connection is already assigned to a room.');
    const entry = room.disconnectedPlayers.get(payload.token);
    if (!entry) return emitError(socket, 'Your reconnect window has expired. Rejoin from the lobby if it is still open.');
    clearTimeout(entry.timer);
    room.disconnectedPlayers.delete(payload.token);
    const oldId = entry.oldId, player = entry.player;
    const wasAnswerer = room.answererId === oldId;
    const remainingTurnMs = room.turnDeadline ? Math.max(1, room.turnDeadline - Date.now()) : ANSWER_TIME_MS;
    if (room.triedPlayerIds.has(oldId)) { room.triedPlayerIds.delete(oldId); room.triedPlayerIds.add(socket.id); }
    if (room.answererId === oldId) room.answererId = socket.id;
    if (room.buzzWinnerId === oldId) room.buzzWinnerId = socket.id;
    player.id = socket.id; player.connected = true;
    room.players.set(socket.id, player);
    socket.join(room.code); socket.data.role = 'player'; socket.data.roomCode = room.code;
    cancelTimer(room); scheduleCleanup(room, ROOM_TTL_MS);
    socket.emit('player:joined', { code: room.code, playerId: socket.id, token: player.token, reconnected: true });
    if (wasAnswerer && room.status === 'answering') startTurnTimer(room, remainingTurnMs, 'answering');
    broadcast(room);
  });

  socket.on('host:start', payload => {
    if (!isPayload(payload)) return emitError(socket, 'Invalid start request.');
    const room = getRoom(socket, payload.code);
    if (!room || !isHost(socket, room)) return;
    if (room.status !== 'lobby' && room.status !== 'ended') return emitError(socket, 'The current round must finish before starting another.');
    if (room.players.size < 2) return emitError(socket, 'At least 2 participants must join before the game starts.');
    if (room.status === 'ended') return emitError(socket, 'Use next question to continue the game.');
    resetRound(room, nextQuestion(room));
    socket.emit('host:round', { question: room.question });
    broadcast(room);
  });

  socket.on('host:next', payload => {
    if (!isPayload(payload)) return emitError(socket, 'Invalid next-question request.');
    const room = getRoom(socket, payload.code);
    if (!room || !isHost(socket, room)) return;
    if (room.status !== 'ended') return emitError(socket, 'Finish the current question first.');
    const activePlayers = [...room.players.values()].filter(p => p.connected);
    if (activePlayers.length < 2) return emitError(socket, 'At least 2 connected participants are needed to continue.');
    resetRound(room, nextQuestion(room));
    socket.emit('host:round', { question: room.question });
    broadcast(room);
  });

  socket.on('player:buzz', payload => {
    if (!isPayload(payload)) return emitError(socket, 'Invalid buzzer request.');
    const room = getRoom(socket, payload.code);
    if (!room || !isPlayer(socket, room)) return;
    if (room.status !== 'buzzing') return emitError(socket, 'The buzzer is not open yet.');
    if (room.triedPlayerIds.has(socket.id)) return emitError(socket, 'You have already had a turn this question.');
    if (!room.players.get(socket.id)?.connected) return emitError(socket, 'Reconnect before buzzing.');
    room.buzzWinnerId = socket.id;
    room.answererId = socket.id;
    room.status = 'answering';
    startTurnTimer(room, ANSWER_TIME_MS, 'answering');
    room.lastResult = { type: 'buzz', playerId: socket.id, name: room.players.get(socket.id).name };
    broadcast(room);
  });

  socket.on('player:submit', payload => {
    if (!isPayload(payload)) return emitError(socket, 'Invalid answer request.');
    const room = getRoom(socket, payload.code);
    if (!room || !isPlayer(socket, room)) return;
    if (room.status !== 'answering' || room.answererId !== socket.id) return emitError(socket, 'You do not currently have the answer turn.');
    if (room.submittedAnswer) return emitError(socket, 'Your answer is already locked.');
    const answer = cleanAnswer(payload.answer);
    if (!answer) return emitError(socket, 'Type an answer before locking it in.');
    clearTurnTimer(room);
    room.submittedAnswer = answer;
    room.triedPlayerIds.add(socket.id);
    room.status = 'host-review';
    startTurnTimer(room, HOST_REVIEW_TIME_MS, 'host-review');
    broadcast(room);
  });

  socket.on('host:resolve', payload => {
    if (!isPayload(payload)) return emitError(socket, 'Invalid scoring request.');
    const room = getRoom(socket, payload.code);
    if (!room || !isHost(socket, room)) return;
    if (room.status !== 'host-review' || !room.answererId || !room.submittedAnswer) return emitError(socket, 'There is no answer waiting to be resolved.');
    const index = Number(payload.answerIndex);
    if (!Number.isInteger(index) || index < 0 || index >= 6 || room.revealed.includes(index)) return emitError(socket, 'That answer is unavailable or has already been awarded.');
    const player = room.players.get(room.answererId);
    const answer = room.question?.answers?.[index];
    if (!player || !answer || !player.connected) return emitError(socket, 'The active player or answer is no longer available.');
    clearTurnTimer(room);
    player.score += Number(answer.points);
    room.revealed.push(index);
    room.lastResult = { type: 'correct', playerId: player.id, name: player.name, points: Number(answer.points), answerIndex: index };
    room.winnerId = player.id;
    room.winnerName = player.name;
    endRound(room);
    broadcast(room);
  });

  socket.on('host:wrong', payload => {
    if (!isPayload(payload)) return emitError(socket, 'Invalid answer decision.');
    const room = getRoom(socket, payload.code);
    if (!room || !isHost(socket, room)) return;
    if (room.status !== 'host-review' || !room.answererId || !room.submittedAnswer) return emitError(socket, 'There is no answer waiting to be marked wrong.');
    if (!markCurrentAnswerWrong(room)) return emitError(socket, 'The answer could not be resolved.');
    broadcast(room);
  });

  socket.on('host:reset', payload => {
    if (!isPayload(payload)) return emitError(socket, 'Invalid reset request.');
    const room = getRoom(socket, payload.code);
    if (!room || !isHost(socket, room)) return;
    clearTurnTimer(room);
    room.status = 'lobby'; room.question = null; room.revealed = []; room.buzzWinnerId = null;
    room.answererId = null; room.triedPlayerIds = new Set(); room.submittedAnswer = null;
    room.lastResult = null; room.winnerId = null; room.winnerName = null; room.roundNumber = 0;
    room.questionBag = shuffledQuestionIds(); room.lastQuestionId = null;
    room.players.forEach(p => { p.score = 0; });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (room.hostId === socket.id) {
      room.statusBeforeHostDisconnect = room.status;
      if (['answering', 'host-review'].includes(room.status)) room.pausedTurnRemainingMs = Math.max(1, (room.turnDeadline || Date.now()) - Date.now());
      clearTurnTimer(room);
      room.status = 'host-disconnected';
      io.to(code).emit('host:disconnected');
      scheduleCleanup(room, HOST_GRACE_MS);
      broadcast(room, false);
      return;
    }
    if (room.players.has(socket.id)) {
      const player = room.players.get(socket.id);
      const wasAnswerer = room.answererId === socket.id;
      room.players.delete(socket.id);
      player.connected = false;
      const entry = { player, oldId: socket.id, timer: null };
      entry.timer = setTimeout(() => {
        if (room.disconnectedPlayers.get(player.token) === entry) room.disconnectedPlayers.delete(player.token);
      }, 60000);
      entry.timer.unref?.();
      room.disconnectedPlayers.set(player.token, entry);
      if (wasAnswerer && ['answering', 'host-review'].includes(room.status)) {
        room.triedPlayerIds.add(socket.id);
        reopenBuzzerOrEnd(room);
      }
      if (room.players.size < 2 && room.status === 'buzzing') room.status = 'lobby';
      broadcast(room);
    }
  });
});

server.listen(PORT, () => console.log(`SUSTAINI-FEUD running on port ${PORT}`));
