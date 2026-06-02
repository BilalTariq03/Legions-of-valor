import { inject } from 'https://cdn.jsdelivr.net/npm/@vercel/analytics@2/+esm';
import { initFirebase, getUid, isFirebaseConfigured } from './firebase.js';
import { createRoom, createAiRoom, joinRoom, listenToRoom, dispatchRoomAction, inviteLink, extractRoomCode, writeGameStateDirect } from './multiplayer.js';
import { renderTitle, renderLobby, renderGame, seatByUid } from './ui/ui.js';
import { BOT_UID, maybeRunBot } from './ai/ai-player.js';
import { reduceGameState } from './core/reducer.js';
import { firebaseReady } from './firebase.js';
import { CARD_DATABASE, FACTIONS } from './data/cards.js';
import { DECK_SIZE, loadCustomDecks, saveCustomDeck, deleteCustomDeck, cardTemplateById, getDecksForFaction, randomFaction } from './data/decks.js';

// Initialize Vercel Web Analytics
inject();

const app = document.getElementById('app');
const uiState = {
  room: null,
  roomCode: null,
  unsubscribe: null,
  selectedCardId: null,
  selectedUnitLane: null,
  configured: false,
  lastRoomSignature: ''
};

window.__lovParrySelection = [];
const autoStartAttempts = new Set();

function currentSeatForState(state) {
  return state ? seatByUid(state, getUid()) : null;
}

function canAutoStartFromLobby(room) {
  const state = room?.gameState;
  if (!state || state.status !== 'lobby') return false;
  if (!state.players?.p1?.uid || !state.players?.p2?.uid) return false;
  if (!state.players.p1.faction || !state.players.p2.faction) return false;
  if (!state.players.p1.ready || !state.players.p2.ready) return false;
  return true;
}

async function maybeAutoStartOnlineDuel(room) {
  // Online ready handshake: once both ready flags are visible in Firebase, only
  // Player 1 performs the heavier START_GAME write. This separates the small
  // Ready click from the deck-building/start-game write so the second Ready
  // button does not get stuck carrying all of that work.
  if (!canAutoStartFromLobby(room)) return;
  if (room?.gameState?.gameMode === 'ai') return;
  const seat = currentSeatForState(room.gameState);
  if (seat === 'p2') return;
  const key = `${room.gameState.roomCode}:${room.gameState.version || 0}:start`;
  if (autoStartAttempts.has(key)) return;
  autoStartAttempts.add(key);

  try {
    toast('Both commanders are ready. Starting duel...');
    await dispatch({ type: 'START_GAME', force: true, seat: 'p1' });
  } catch (err) {
    console.error('Auto-start failed:', err);
    toast(err?.message || 'Auto-start failed. Use Start Duel Now.');
  }
}

function seatStorageKey(roomCode) {
  return `lovSeat_${roomCode}`;
}

function rememberSeat(roomCode, seat) {
  if (!roomCode || !['p1', 'p2'].includes(seat)) return;
  localStorage.setItem(seatStorageKey(roomCode), seat);
  localStorage.setItem('lovLastOnlineSeat', seat);
}

function clearRoomRenderCache() {
  uiState.lastRoomSignature = '';
}

function roomSignature(room) {
  // Only compare the actual game state. lastUpdated can change independently and
  // should not force a full screen redraw, because repeated redraws close open
  // dropdowns and make buttons look like they are looping.
  try { return JSON.stringify(room?.gameState || null); }
  catch (_) { return String(Date.now()); }
}

async function boot() {
  const fb = await initFirebase();
  uiState.configured = fb.configured;
  const url = new URL(window.location.href);
  const roomFromUrl = url.searchParams.get('room') || '';
  render(roomFromUrl);
}

function render(roomFromUrl = '') {
  if (!uiState.room) {
    app.innerHTML = renderTitle({ configured: isFirebaseConfigured(), roomFromUrl });
    hydrateTitleTools();
    return;
  }
  const state = uiState.room.gameState;
  if (state.status === 'lobby') {
    app.innerHTML = renderLobby(uiState.room, getUid(), inviteLink(uiState.roomCode));
  } else {
    app.innerHTML = renderGame(uiState.room, getUid(), uiState);
    // Solo mode: after the board renders, let the AI take one legal action
    // if it is currently the bot's turn or the bot must answer a Parry prompt.
    maybeRunBot(uiState.room, uiState.roomCode, async (botAction) => {
      return await dispatchRoomAction(uiState.roomCode, botAction, BOT_UID);
    });
  }
}

async function startListening(code) {
  if (uiState.unsubscribe) uiState.unsubscribe();
  uiState.roomCode = code;
  clearRoomRenderCache();
  uiState.unsubscribe = listenToRoom(code, room => {
    if (!room) return;

    const sig = roomSignature(room);
    if (sig === uiState.lastRoomSignature) {
      // Firebase polling can return the same room again. Avoid re-rendering the
      // entire lobby on unchanged snapshots; otherwise dropdowns close while the
      // player is trying to pick a faction/deck and hover animations look like
      // they are restarting in a loop.
      return;
    }

    uiState.lastRoomSignature = sig;
    uiState.room = room;
    render();
    // Run after render so both screens first show the correct Ready/Unready
    // status, then Player 1 attempts the separate start-game action.
    setTimeout(() => maybeAutoStartOnlineDuel(room), 250);
  });
}

async function dispatch(action) {
  if (!uiState.roomCode) return;

  // Always include the seat this browser currently controls. This is important
  // for LAN/Firebase testing because anonymous auth can occasionally refresh or
  // the local UI can be one render behind the room state. The reducer still
  // validates turn/phase, but it now has a stable seat hint.
  const state = uiState.room?.gameState;
  const mySeat = currentSeatForState(state);
  const enrichedAction = mySeat && !action.seat ? { ...action, seat: mySeat } : action;
  window.__lovLastAction = enrichedAction;

  // Use the UID saved on the player's seat when available. Firebase rules only
  // require auth != null, so this lets the rules engine identify the correct
  // in-game player even if Edge/Firebase auth changed the temporary UID.
  const actorUid = mySeat ? (state.players[mySeat]?.uid || getUid()) : getUid();

  // Do NOT locally fast-write lobby state anymore. Earlier builds could create
  // split-brain states where Player 1 saw the game start but Player 2 stayed in
  // lobby. Every online action now reads the latest Firebase room, applies the
  // rule, writes it, then the listener/poller updates both laptops.
  return await dispatchRoomAction(uiState.roomCode, enrichedAction, actorUid);
}
function inputValue(id, fallback = '') {
  return document.getElementById(id)?.value?.trim() || fallback;
}

function currentName() {
  return inputValue('playerName') || inputValue('joinName') || inputValue('aiName') || localStorage.getItem('lovName') || 'Commander';
}

function saveName(name) { localStorage.setItem('lovName', name || 'Commander'); }

async function copyTextSafely(text) {
  // Clipboard API only works on HTTPS or on localhost in many browsers.
  // When testing through a same-Wi-Fi IP address like http://192.168.x.x,
  // Edge may block navigator.clipboard, so we use a classic fallback.
  const value = String(text || '');
  if (!value) throw new Error('No invite link to copy.');

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  const existingInput = document.getElementById('inviteLinkText');
  let input = existingInput;
  let createdTemporaryInput = false;

  if (!input) {
    input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', 'readonly');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    document.body.appendChild(input);
    createdTemporaryInput = true;
  } else {
    input.value = value;
  }

  input.focus();
  input.select();
  input.setSelectionRange(0, value.length);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    if (createdTemporaryInput) input.remove();
  }

  if (!copied) {
    throw new Error('Browser blocked automatic copy. The invite link is selected, press Ctrl+C.');
  }
  return true;
}

// One click handler controls the whole game. This makes it mouse-first and beginner-readable.
document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  event.preventDefault();

  // Let native form controls, especially the faction dropdown, behave normally.
  // Without this guard, a click on the <select> is treated like a game action.
  if (action === 'select-faction') return;

  try {
    if (action === 'create-room') {
      const name = currentName(); saveName(name);
      const room = await createRoom(getUid(), name);
      uiState.room = room;
      rememberSeat(room.roomCode, 'p1');
      history.replaceState(null, '', `?room=${room.roomCode}`);
      await startListening(room.roomCode);
      return;
    }
    if (action === 'create-ai-room') {
      const originalText = el.textContent;
      el.disabled = true;
      el.textContent = 'Starting AI duel...';
      try {
        const name = currentName(); saveName(name);
        const playerFaction = inputValue('aiPlayerFaction', 'Humans');
        const rawBotFaction = inputValue('aiBotFaction', 'random');
        const botFaction = rawBotFaction === 'random' ? randomFaction(playerFaction) : rawBotFaction;
        const difficulty = inputValue('aiDifficulty', 'normal');
        const playerDeckId = inputValue('aiPlayerDeck', `default_${playerFaction.toLowerCase()}`);
        const rawBotDeckId = inputValue('aiBotDeck', 'auto');
        const botDeckId = rawBotDeckId === 'auto' ? `default_${botFaction.toLowerCase()}` : rawBotDeckId;
        const room = await createAiRoom(getUid(), name, playerFaction, botFaction, difficulty, playerDeckId, botDeckId);
        uiState.room = room;
        rememberSeat(room.roomCode, 'p1');
        history.replaceState(null, '', `?room=${room.roomCode}&mode=ai`);
        await startListening(room.roomCode);
      } finally {
        if (document.body.contains(el)) {
          el.disabled = false;
          el.textContent = originalText;
        }
      }
      return;
    }
    if (action === 'join-room') {
      const name = currentName(); saveName(name);
      const code = extractRoomCode(inputValue('roomCode'));
      const room = await joinRoom(code, getUid(), name);
      uiState.room = room;
      const joinedSeat = room.mySeat || seatByUid(room.gameState, getUid()) || 'p2';
      rememberSeat(room.roomCode, joinedSeat);
      history.replaceState(null, '', `?room=${room.roomCode}`);
      await startListening(room.roomCode);
      return;
    }
    if (action === 'return-title') {
      if (uiState.unsubscribe) uiState.unsubscribe();
      uiState.room = null; uiState.roomCode = null; uiState.selectedCardId = null; uiState.selectedUnitLane = null; clearRoomRenderCache();
      history.replaceState(null, '', window.location.pathname);
      render();
      return;
    }
    if (action === 'copy-link') {
      const link = inviteLink(uiState.roomCode);
      await copyTextSafely(link);
      toast('Invite link copied.');
      return;
    }
    if (action === 'select-invite-link') {
      const input = document.getElementById('inviteLinkText');
      if (input) input.select();
      return;
    }
    if (action === 'builder-save') {
      saveDeckFromBuilder();
      hydrateTitleTools();
      toast('Custom deck saved. It now appears in deck selectors.');
      return;
    }
    if (action === 'builder-clear') {
      window.__lovDeckBuilder = { faction: inputValue('builderFaction', 'Elves'), faction2: inputValue('builderFaction2', ''), cardIds: [] };
      hydrateTitleTools();
      return;
    }
    if (action === 'builder-add-card') {
      addCardToBuilder(el.dataset.cardId);
      hydrateTitleTools();
      return;
    }
    if (action === 'builder-remove-card') {
      removeCardFromBuilder(el.dataset.cardId);
      hydrateTitleTools();
      return;
    }
    if (action === 'builder-delete-deck') {
      if (confirm('Delete this custom deck?')) {
        deleteCustomDeck(el.dataset.deckId);
        hydrateTitleTools();
        toast('Custom deck deleted.');
      }
      return;
    }
    if (action === 'claim-seat') {
      await dispatch({ type: 'CLAIM_SEAT', seat: el.dataset.seat, name: currentName() });
      rememberSeat(uiState.roomCode, el.dataset.seat);
      return;
    }
    if (action === 'ready-player') {
      // Read the latest room state instead of trusting the button's HTML data.
      // This makes the Ready button more reliable when another laptop updates
      // the lobby at the same time.
      const state = uiState.room?.gameState;
      const mySeat = currentSeatForState(state);
      const seat = mySeat || el.dataset.seat;
      const currentReady = !!state?.players?.[seat]?.ready;
      const originalText = el.textContent;
      el.disabled = true;
      el.textContent = currentReady ? 'Unreadying...' : 'Readying...';
      try {
        await Promise.race([
          dispatch({ type: 'READY_PLAYER', ready: !currentReady, seat }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Ready action timed out. Check internet/Firebase, then click again.')), 15000))
        ]);
      } catch (err) {
        console.error(err);
        toast(err?.message || 'Ready failed.');
      } finally {
        // If Firebase fails before the room listener re-renders the lobby, do not
        // leave the button visually stuck forever.
        if (document.body.contains(el)) {
          el.disabled = false;
          el.textContent = originalText;
        }
      }
      return;
    }
    if (action === 'force-start-game') {
      const originalText = el.textContent;
      el.disabled = true;
      el.textContent = 'Starting duel...';
      try {
        await dispatch({ type: 'START_GAME', force: true });
      } finally {
        if (document.body.contains(el)) {
          el.disabled = false;
          el.textContent = originalText;
        }
      }
      return;
    }
    if (action === 'select-card') {
      uiState.selectedCardId = el.dataset.cardId;
      uiState.selectedUnitLane = null;
      render();
      return;
    }
    if (action === 'select-unit') {
      uiState.selectedUnitLane = el.dataset.lane;
      uiState.selectedCardId = null;
      render();
      return;
    }
    if (action === 'clear-selection') {
      uiState.selectedCardId = null; uiState.selectedUnitLane = null; window.__lovParrySelection = [];
      render();
      return;
    }
    if (action === 'select-battleplan') {
      await dispatch({ type: 'SELECT_BATTLEPLAN', battleplanId: el.dataset.battleplanId, seat: uiState.room?.gameState?.activePlayer });
      return;
    }
    if (action === 'play-unit') {
      await dispatch({ type: 'PLAY_UNIT', cardId: el.dataset.cardId, lane: el.dataset.lane });
      uiState.selectedCardId = null;
      return;
    }
    if (action === 'play-equipment') {
      await dispatch({ type: 'PLAY_EQUIPMENT', cardId: el.dataset.cardId, lane: el.dataset.lane });
      uiState.selectedCardId = null;
      return;
    }
    if (action === 'play-event') {
      await dispatch({ type: 'PLAY_EVENT', cardId: el.dataset.cardId, targetLane: el.dataset.lane });
      uiState.selectedCardId = null;
      return;
    }
    if (action === 'tribute-card') {
      await dispatch({ type: 'TRIBUTE_CARD', cardId: el.dataset.cardId });
      uiState.selectedCardId = null;
      return;
    }
    if (action === 'set-facedown') {
      await dispatch({ type: 'SET_FACE_DOWN', cardId: el.dataset.cardId, lane: el.dataset.lane });
      uiState.selectedCardId = null;
      return;
    }
    if (action === 'end-deployment') {
      await dispatch({ type: 'END_DEPLOYMENT' });
      return;
    }
    if (action === 'declare-attack') {
      await dispatch({ type: 'DECLARE_ATTACK', fromLane: el.dataset.fromLane, toLane: el.dataset.toLane, strikeStyle: el.dataset.style });
      uiState.selectedUnitLane = null;
      return;
    }
    if (action === 'activate-ability') {
      await dispatch({ type: 'ACTIVATE_ABILITY', lane: el.dataset.lane, targetLane: el.dataset.targetLane });
      return;
    }
    if (action === 'toggle-parry-card') {
      const id = el.dataset.cardId;
      const set = new Set(window.__lovParrySelection || []);
      set.has(id) ? set.delete(id) : set.add(id);
      window.__lovParrySelection = [...set];
      render();
      return;
    }
    if (action === 'submit-parry') {
      await dispatch({ type: 'SUBMIT_PARRY', cardIds: window.__lovParrySelection || [] });
      window.__lovParrySelection = [];
      return;
    }
    if (action === 'decline-parry') {
      await dispatch({ type: 'DECLINE_PARRY' });
      window.__lovParrySelection = [];
      return;
    }
    if (action === 'end-conflict') {
      await dispatch({ type: 'END_CONFLICT' });
      return;
    }
    if (action === 'concede') {
      if (confirm('Concede this duel?')) await dispatch({ type: 'CONCEDE' });
      return;
    }
    if (action === 'rematch') {
      await dispatch({ type: 'REMATCH' });
      return;
    }
  } catch (err) {
    console.error(err);
    toast(err.message || 'Something went wrong.');
  }
});

document.addEventListener('change', async (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'select-faction') {
    try {
      await dispatch({ type: 'SELECT_FACTION', faction: el.value });
    } catch (err) {
      console.error(err);
      toast(err.message || 'Faction selection failed.');
    }
  }
  if (el.dataset.action === 'select-deck') {
    try {
      await dispatch({ type: 'SELECT_DECK', deckId: el.value });
    } catch (err) {
      console.error(err);
      toast(err.message || 'Deck selection failed.');
    }
  }
  if (el.dataset.action === 'builder-refresh') {
    const faction2 = document.getElementById('builderFaction2')?.value || '';
    window.__lovDeckBuilder = { faction: el.value, faction2, cardIds: [] };
    hydrateTitleTools();
  }
  if (el.dataset.action === 'builder-refresh2') {
    const state = ensureBuilderState();
    state.faction2 = el.value;
    hydrateTitleTools();
  }
  if (el.dataset.action === 'refresh-title-decks') {
    refreshTitleDeckDropdowns();
  }
});


function ensureBuilderState() {
  if (!window.__lovDeckBuilder) {
    window.__lovDeckBuilder = {
      faction: document.getElementById('builderFaction')?.value || 'Elves',
      faction2: document.getElementById('builderFaction2')?.value || '',
      cardIds: []
    };
  }
  return window.__lovDeckBuilder;
}

function hydrateTitleTools() {
  if (!document.getElementById('builderCards')) return;
  renderDeckBuilder();
  refreshTitleDeckDropdowns(false);
}

function refreshTitleDeckDropdowns(resetToDefault = true) {
  const playerFaction = document.getElementById('aiPlayerFaction')?.value || 'Humans';
  const botFactionRaw = document.getElementById('aiBotFaction')?.value || 'random';
  const playerDeck = document.getElementById('aiPlayerDeck');
  const botDeck = document.getElementById('aiBotDeck');
  if (playerDeck) {
    const previous = playerDeck.value;
    playerDeck.innerHTML = deckOptionsForFaction(playerFaction);
    playerDeck.value = resetToDefault ? `default_${playerFaction.toLowerCase()}` : (previous || `default_${playerFaction.toLowerCase()}`);
  }
  if (botDeck) {
    const previous = botDeck.value;
    const faction = botFactionRaw === 'random' ? 'random' : botFactionRaw;
    botDeck.innerHTML = `<option value="auto">Auto: default deck for bot faction</option>` + (faction === 'random' ? allDeckOptions() : deckOptionsForFaction(faction));
    botDeck.value = resetToDefault ? 'auto' : (previous || 'auto');
  }
}

function deckOptionsForFaction(faction) {
  return getDecksForFaction(faction).map(deck => `<option value="${escapeHtml(deck.id)}">${escapeHtml(deck.name)} ${deck.isDefault ? '(Default)' : '(Custom)'}</option>`).join('');
}

function allDeckOptions() {
  return FACTIONS.map(f => getDecksForFaction(f).map(deck => `<option value="${escapeHtml(deck.id)}">${escapeHtml(f)} — ${escapeHtml(deck.name)}</option>`).join('')).join('');
}

function renderDeckBuilder() {
  const state = ensureBuilderState();
  const factionSelect = document.getElementById('builderFaction');
  if (factionSelect) factionSelect.value = state.faction;
  const faction2Select = document.getElementById('builderFaction2');
  if (faction2Select && state.faction2 !== undefined) faction2Select.value = state.faction2 || '';

  const counts = countIds(state.cardIds);
  const countEl = document.getElementById('builderCount');
  if (countEl) countEl.textContent = `${state.cardIds.length} / ${DECK_SIZE} cards`;

  const selectedEl = document.getElementById('builderSelected');
  if (selectedEl) {
    selectedEl.innerHTML = state.cardIds.length
      ? Object.entries(counts).map(([id, count]) => {
          const card = cardTemplateById(id);
          return card ? `<button class="mini-card-line" data-action="builder-remove-card" data-card-id="${escapeHtml(id)}">− ${escapeHtml(card.name)} ×${count}</button>` : '';
        }).join('')
      : '<div class="small-note">No cards selected yet. Add cards from the pool below.</div>';
  }

  const poolEl = document.getElementById('builderCards');
  if (poolEl) {
    const faction2 = state.faction2 || '';
    const pool = CARD_DATABASE.filter(c =>
      c.faction === state.faction ||
      (faction2 && c.faction === faction2) ||
      c.type === 'eventTrap' ||
      c.type === 'equipment'
    );
    poolEl.innerHTML = pool.map(card => {
      const count = counts[card.id] || 0;
      const max = card.elite ? 1 : 2;
      const disabled = state.cardIds.length >= DECK_SIZE || count >= max;
      return `<button class="builder-card-button" data-action="builder-add-card" data-card-id="${escapeHtml(card.id)}" ${disabled ? 'disabled' : ''}>+ ${escapeHtml(card.name)} <span>${escapeHtml(card.faction)} · ${escapeHtml(card.type)} · ${card.cost ?? 0}TP · ${count}/${max}</span></button>`;
    }).join('');
  }

  const savedEl = document.getElementById('savedDecks');
  if (savedEl) {
    const custom = loadCustomDecks();
    savedEl.innerHTML = custom.length ? custom.map(deck => {
      const factionLabel = Array.isArray(deck.factions) ? deck.factions.join(' + ') : (deck.faction || '');
      return `<div class="saved-deck-row"><span>${escapeHtml(deck.name)} — ${escapeHtml(factionLabel)} (${deck.cardIds.length})</span><button data-action="builder-delete-deck" data-deck-id="${escapeHtml(deck.id)}">Delete</button></div>`;
    }).join('') : '<div class="small-note">No custom decks saved yet.</div>';
  }
}

function addCardToBuilder(cardId) {
  const state = ensureBuilderState();
  const card = cardTemplateById(cardId);
  if (!card) return;
  if (state.cardIds.length >= DECK_SIZE) return toast(`Deck is already at ${DECK_SIZE} cards.`);
  const count = state.cardIds.filter(id => id === cardId).length;
  const max = card.elite ? 1 : 2;
  if (count >= max) return toast(`Copy limit reached for ${card.name}.`);
  state.cardIds.push(cardId);
}

function removeCardFromBuilder(cardId) {
  const state = ensureBuilderState();
  const index = state.cardIds.indexOf(cardId);
  if (index >= 0) state.cardIds.splice(index, 1);
}

function saveDeckFromBuilder() {
  const state = ensureBuilderState();
  const faction2 = state.faction2 || '';
  const factionLabel = faction2 ? `${state.faction}+${faction2}` : state.faction;
  const name = inputValue('builderDeckName', `${factionLabel} Custom Deck`);
  if (state.cardIds.length !== DECK_SIZE) throw new Error(`Deck must contain exactly ${DECK_SIZE} cards.`);
  const factions = faction2 ? [state.faction, faction2] : [state.faction];
  const deck = {
    id: `custom_${Date.now()}`,
    name,
    faction: state.faction,
    factions,
    isDefault: false,
    cardIds: [...state.cardIds]
  };
  saveCustomDeck(deck);
  window.__lovDeckBuilder = { faction: state.faction, faction2, cardIds: [] };
  const nameInput = document.getElementById('builderDeckName');
  if (nameInput) nameInput.value = '';
}

function countIds(ids) {
  return ids.reduce((acc, id) => {
    acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {});
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function toast(message) {
  const div = document.createElement('div');
  div.className = 'error-toast';
  div.textContent = message;
  document.body.appendChild(div);
  // Keep errors visible long enough to read during LAN testing.
  setTimeout(() => div.remove(), 6500);
}

boot();
