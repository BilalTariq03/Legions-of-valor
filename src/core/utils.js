// Generic helper functions shared by the rules, reducer, multiplayer, and UI layers.
export function deepClone(value) {
  // JSON clone keeps the state simple and serializable for Firebase.
  return JSON.parse(JSON.stringify(value));
}

export function randomId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function roomCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function otherPlayer(playerKey) {
  return playerKey === 'p1' ? 'p2' : 'p1';
}

export function clampMin(value, min = 0) {
  return Math.max(min, value || 0);
}

export function safeName(name) {
  return String(name || '').replace(/[<>]/g, '').slice(0, 24) || 'Commander';
}

export function titleCaseLane(lane) {
  return lane ? lane[0].toUpperCase() + lane.slice(1) : '';
}

export function nowStamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
