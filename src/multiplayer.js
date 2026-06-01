import { fb, getDb, firebaseReady } from './firebase.js';
import { createInitialGameState } from './core/game-state.js';
import { reduceGameState } from './core/reducer.js';
import { CONFIG } from './core/config.js';
import { roomCode } from './core/utils.js';
import { BOT_UID, botDisplayName } from './ai/ai-player.js';

// Local fallback: helps you preview UI before Firebase config is added.
// It is NOT online multiplayer. Online 1v1 requires Firebase configured.
//
// Earlier versions used setInterval() to re-render the local room every 700ms.
// That made normal browser controls, especially faction <select> dropdowns, close
// immediately because the whole lobby was being redrawn while the menu was open.
// The local preview now uses a tiny event-listener system instead: render once,
// then render again only after an actual game action changes the local room.
const localRooms = new Map();
const localRoomListeners = new Map();

function emitLocalRoom(roomCodeValue) {
  const callback = localRoomListeners.get(roomCodeValue);
  if (callback) callback(localRooms.get(roomCodeValue) || null);
}

// Firebase Realtime Database cannot save JavaScript undefined values.
// Deck/card objects can contain optional fields, especially on equipment/events,
// so we remove undefined before writing the room back to Firebase.
// Without this, the second Ready click can fail because that click starts the
// game and creates full decks containing optional card fields.
function stripUndefined(value) {
  // Firebase Realtime Database rejects undefined, NaN/Infinity, and normal
  // object keys that contain dots. We keep this sanitizer strict so one bad
  // optional card field cannot freeze a lobby action.
  if (value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (Array.isArray(value)) return value.map(child => stripUndefined(child));
  if (value && typeof value === 'object') {
    // If a serverTimestamp placeholder somehow comes back through local cache,
    // replace it with a normal number before the next full-room write.
    if (Object.prototype.hasOwnProperty.call(value, '.sv')) return Date.now();
    const cleaned = {};
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      if (key.includes('.') || key.includes('#') || key.includes('$') || key.includes('[') || key.includes(']')) continue;
      cleaned[key] = stripUndefined(child);
    }
    return cleaned;
  }
  return value;
}

function prepareRoomForFirebase(room) {
  return stripUndefined(room);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out. Check Firebase rules, internet connection, and browser console.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Accepts either a bare room code like ABC123 or a full invite link like
// http://192.168.1.25:5173/?room=ABC123. This makes the Join box easier
// for beginners because Player 2 can paste whatever Player 1 sends.
export function extractRoomCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    const fromQuery = url.searchParams.get('room');
    if (fromQuery) return String(fromQuery).trim().toUpperCase();
  } catch (_) {
    // Not a full URL. Continue and treat it as a normal room code.
  }

  const queryMatch = raw.match(/[?&]room=([A-Za-z0-9_-]+)/i);
  if (queryMatch) return queryMatch[1].trim().toUpperCase();

  return raw.replace(/[^A-Za-z0-9_-]/g, '').trim().toUpperCase();
}

export async function createRoom(uid, playerName) {
  const code = roomCode(CONFIG.ROOM_CODE_LENGTH);
  const gameState = createInitialGameState(code);
  gameState.players.p1.uid = uid;
  gameState.players.p1.name = playerName || 'Commander I';
  gameState.players.p1.connected = true;

  if (!firebaseReady()) {
    localRooms.set(code, { roomCode: code, gameState, createdAt: Date.now() });
    return { roomCode: code, gameState, local: true, mySeat: 'p1' };
  }

  const db = getDb();
  const roomRef = fb.ref(db, `rooms/${code}`);
  await fb.set(roomRef, prepareRoomForFirebase({
    roomCode: code,
    createdAt: fb.serverTimestamp(),
    lastUpdated: fb.serverTimestamp(),
    gameState
  }));
  return { roomCode: code, gameState, local: false, mySeat: 'p1' };
}


export async function createAiRoom(uid, playerName, playerFaction = 'Humans', botFaction = 'Orcs', difficulty = 'normal', playerDeckId = null, botDeckId = null) {
  const code = roomCode(CONFIG.ROOM_CODE_LENGTH);
  let gameState = createInitialGameState(code);

  // AI mode is intentionally LOCAL ONLY.
  // It does not need Firebase, internet, a second laptop, or an open Firebase Console.
  // This also avoids a common beginner problem where a Firebase write/rules issue
  // makes the Start AI Duel button look like it is doing nothing.
  // Online 1v1 still uses Firebase rooms; solo AI is kept in this browser tab.
  gameState.gameMode = 'ai';
  gameState.ai = { enabled: true, difficulty, localOnly: true };
  gameState.players.p1.uid = uid;
  gameState.players.p1.name = playerName || 'Commander';
  gameState.players.p1.connected = true;
  gameState.players.p1.faction = playerFaction;
  gameState.players.p1.deckChoiceId = playerDeckId || `default_${String(playerFaction).toLowerCase()}`;
  gameState.players.p1.ready = true;

  gameState.players.p2.uid = BOT_UID;
  gameState.players.p2.name = botDisplayName(difficulty);
  gameState.players.p2.connected = true;
  gameState.players.p2.isBot = true;
  gameState.players.p2.aiDifficulty = difficulty;
  gameState.players.p2.faction = botFaction;
  gameState.players.p2.deckChoiceId = botDeckId || `default_${String(botFaction).toLowerCase()}`;
  gameState.players.p2.ready = true;
  gameState.log.unshift(`Solo duel created locally: ${gameState.players.p1.name} vs ${gameState.players.p2.name}.`);

  gameState = reduceGameState(gameState, { type: 'START_GAME', force: true }, uid);
  gameState.gameMode = 'ai';
  gameState.ai = { enabled: true, difficulty, localOnly: true };

  const roomData = { roomCode: code, gameState, createdAt: Date.now(), local: true, aiLocal: true };
  localRooms.set(code, roomData);
  emitLocalRoom(code);
  return roomData;
}

export async function joinRoom(code, uid, playerName) {
  const roomCodeClean = extractRoomCode(code);
  if (!roomCodeClean) throw new Error('Enter a room code.');

  if (!firebaseReady()) {
    const room = localRooms.get(roomCodeClean);
    if (!room) throw new Error('Local preview room not found. Configure Firebase for online rooms.');
    room.gameState = reduceGameState(room.gameState, { type: 'CLAIM_SEAT', seat: 'p2', name: playerName }, uid);
    emitLocalRoom(roomCodeClean);
    return { ...room, mySeat: 'p2' };
  }

  // HARD FIX: do not use runTransaction for joining in this beginner LAN build.
  // Some Edge/Firebase combinations were returning the old room to Player 2,
  // so both laptops kept showing P2 as an empty seat even after Join Room.
  // We now do a clear read -> decide seat -> reduce -> write -> read back.
  const db = getDb();
  const roomRef = fb.ref(db, `rooms/${roomCodeClean}`);
  const snap = await withTimeout(fb.get(roomRef), 12000, 'Reading room while joining');
  if (!snap.exists()) throw new Error('Room not found. Ask Player 1 to create a new room and send the latest link.');

  const room = prepareRoomForFirebase(snap.val());
  if (!room?.gameState) throw new Error('Room data is missing. Create a new room.');

  const state = room.gameState;
  const already = state.players.p1.uid === uid ? 'p1' : state.players.p2.uid === uid ? 'p2' : null;
  let seat = already;
  if (!seat) {
    if (!state.players.p1.uid) seat = 'p1';
    else if (!state.players.p2.uid) seat = 'p2';
    else throw new Error('Room is full.');
  }

  const newState = stripUndefined(reduceGameState(state, { type: 'CLAIM_SEAT', seat, name: playerName }, uid));
  if (newState.error) throw new Error(newState.error);

  await withTimeout(fb.set(fb.ref(db, `rooms/${roomCodeClean}/gameState`), newState), 12000, 'Writing joined seat');
  try { await fb.set(fb.ref(db, `rooms/${roomCodeClean}/lastUpdated`), Date.now()); } catch (_) {}

  const after = await withTimeout(fb.get(roomRef), 12000, 'Confirming joined room');
  return { ...after.val(), mySeat: seat };
}

export function listenToRoom(roomCodeValue, callback) {
  // Local AI rooms always stay in memory, even when Firebase is configured for online multiplayer.
  if (localRooms.has(roomCodeValue) || !firebaseReady()) {
    localRoomListeners.set(roomCodeValue, callback);
    callback(localRooms.get(roomCodeValue) || null);
    return () => localRoomListeners.delete(roomCodeValue);
  }
  const db = getDb();
  const roomRef = fb.ref(db, `rooms/${roomCodeValue}`);
  const unsubscribe = fb.onValue(roomRef, snap => callback(snap.val()));

  // Extra sync poller for LAN testing. onValue should be enough, but this makes
  // the lobby recover if a browser tab misses a realtime event while another
  // laptop starts the game.
  const poll = setInterval(async () => {
    try {
      const snap = await fb.get(roomRef);
      if (snap.exists()) callback(snap.val());
    } catch (_) {}
  }, 5000);

  return () => { clearInterval(poll); unsubscribe(); };
}

export async function dispatchRoomAction(roomCodeValue, action, uid) {
  // Local AI rooms should never attempt a Firebase write.
  // They are stored in this browser tab and updated instantly.
  if (localRooms.has(roomCodeValue) || !firebaseReady()) {
    const room = localRooms.get(roomCodeValue);
    if (!room) throw new Error('Local room missing.');
    room.gameState = reduceGameState(room.gameState, action, uid);
    emitLocalRoom(roomCodeValue);
    return room.gameState;
  }

  const db = getDb();
  const roomRef = fb.ref(db, `rooms/${roomCodeValue}`);

  // Earlier builds used Firebase transactions for every lobby/game action.
  // On some Windows/Edge/LAN setups the transaction promise could remain pending,
  // which made the Ready button sit on "Readying...". For this beginner MVP we
  // now do a simple read -> reduce -> write cycle with a timeout. It is much
  // easier to debug and is reliable for a two-player prototype.
  // Later, a production version can move authority to Cloud Functions.
  const snap = await withTimeout(fb.get(roomRef), 12000, 'Reading the Firebase room');
  if (!snap.exists()) throw new Error('Room not found. Create a new room and try again.');

  const room = prepareRoomForFirebase(snap.val());
  if (!room?.gameState) throw new Error('Room data is missing game state. Create a new room.');

  const newState = stripUndefined(reduceGameState(room.gameState, action, uid));
  const cleanState = stripUndefined(newState);
  await withTimeout(fb.set(fb.ref(db, `rooms/${roomCodeValue}/gameState`), cleanState), 12000, 'Writing the game state');
  try { await fb.set(fb.ref(db, `rooms/${roomCodeValue}/lastUpdated`), Date.now()); } catch (_) {}
  return cleanState;
}


export async function writeGameStateDirect(roomCodeValue, gameState) {
  // Hard online-lobby fix: write only /gameState instead of the whole room object.
  // This avoids the Ready/Start button getting stuck when a full-room write is slow
  // or when older room metadata contains serverTimestamp placeholders.
  if (localRooms.has(roomCodeValue) || !firebaseReady()) {
    const room = localRooms.get(roomCodeValue);
    if (!room) throw new Error('Local room missing.');
    room.gameState = gameState;
    emitLocalRoom(roomCodeValue);
    return gameState;
  }

  const db = getDb();
  const cleanState = stripUndefined(gameState);
  await withTimeout(
    fb.set(fb.ref(db, `rooms/${roomCodeValue}/gameState`), cleanState),
    12000,
    'Writing the game state to Firebase'
  );
  // This timestamp write is not required for gameplay, so if it fails we do not
  // block the lobby. It is only useful for debugging old rooms later.
  try {
    await fb.set(fb.ref(db, `rooms/${roomCodeValue}/lastUpdated`), Date.now());
  } catch (_) {}
  return cleanState;
}

export function inviteLink(roomCodeValue) {
  // The runner now opens the game using the computer's LAN address when possible.
  // That means this copied link will be usable on another laptop on the same Wi-Fi.
  // If the page is opened as localhost, the link will still be local-only because
  // browsers cannot reliably discover your Wi-Fi IP from frontend JavaScript.
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomCodeValue);
  return url.toString();
}
