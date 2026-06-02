import { CONFIG } from './config.js';
import { CARD_DATABASE } from '../data/cards.js';
import { getDeckDefinition, createDeckInstances } from '../data/decks.js';
import { freshBattleplanDeck } from '../data/battleplans.js';
import { randomId, shuffle } from './utils.js';

export function emptyBoard() {
  return {
    lanes: {
      left: { unit: null },
      center: { unit: null },
      right: { unit: null }
    },
    backrow: {
      left: null,
      center: null,
      right: null
    }
  };
}

export function emptyPlayer(seat) {
  return {
    seat,
    uid: null,
    name: seat === 'p1' ? 'Commander I' : 'Commander II',
    connected: false,
    // Bot fields are normally false/null for human players.
    // They are filled when the player chooses Play vs AI from the title screen.
    isBot: false,
    aiDifficulty: null,
    ready: false,
    faction: null,
    // deckChoiceId points to either a default faction deck or a custom saved deck.
    // If null, the balanced default deck for this faction is used.
    deckChoiceId: null,
    aurion: CONFIG.STARTING_AURION,
    volatileTributeBonus: 0,
    deck: [],
    hand: [],
    discard: [],
    tribute: [],
    battleplanDeck: [],
    currentBattleplan: null,
    battleplanChoices: [],
    momentumDrawBonus: 0,
    thresholdsTriggered: { ten: false, twenty: false },
    board: emptyBoard(),
    turnFlags: freshTurnFlags()
  };
}

export function freshTurnFlags() {
  return {
    deployedElite: false,
    usedParryChainTwoPlusToWin: false,
    triggeredTrap: false,
    ruseSucceeded: false,
    revealedFaceDown: false,
    attacksDeclaredByLane: [],
    lostUnitThisTurn: false,
    equipmentWasActiveAtEnd: false,
    usedIntelOrSecrecy: false
  };
}

export function createInitialGameState(roomCode) {
  return {
    roomCode,
    status: 'lobby',
    phase: 'lobby',
    activePlayer: 'p1',
    turnNumber: 1,
    winner: null,
    players: {
      p1: emptyPlayer('p1'),
      p2: emptyPlayer('p2')
    },
    pendingAction: null,
    noParryUntilTurnEnd: false,
    selectedPreview: null,
    log: [`Room ${roomCode} created.`],
    version: 1,
    error: null
  };
}

export function instantiateCard(template, owner) {
  const card = {
    ...template,
    owner,
    instanceId: randomId(template.id),
    exposed: false
  };

  // Only units need equipment slots and temporary combat flags.
  // Keeping these fields off events/equipment avoids Firebase write errors from
  // optional undefined values when a full deck is created at game start.
  if (template.type === 'unit') {
    card.equipment = { weapon: null, armor: null };
    card.temp = freshUnitTemp();
  }

  return card;
}

export function freshUnitTemp() {
  return {
    apMod: 0,
    dpMod: 0,
    hasAttacked: false,
    bloodthirstUsed: false,
    cannotAttack: false,
    cannotUseAbility: false,
    noEquipmentBuffThisTurn: false,
    deliriumActive: false
  };
}

export function buildPresetDeck(faction, owner, deckChoiceId = null) {
  // Legacy helper kept for older code paths. It now builds the selected 30-card
  // deck instead of the old 40-card auto-filled pile.
  const definition = getDeckDefinition(deckChoiceId, faction);
  return createDeckInstances(definition, owner, instantiateCard);
}

export function buildSelectedDeck(faction, owner, deckChoiceId = null) {
  const definition = getDeckDefinition(deckChoiceId, faction);
  return createDeckInstances(definition, owner, instantiateCard);
}

export function drawCards(player, amount) {
  player.deck = player.deck || [];
  player.hand = player.hand || [];
  const drawn = [];
  for (let i = 0; i < amount; i++) {
    if (!player.deck.length) break;
    const card = player.deck.shift();
    player.hand.push(card);
    drawn.push(card);
  }
  return drawn;
}

export function resetBoardTemps(player) {
  if (!player?.board?.lanes) return;
  for (const lane of CONFIG.LANES) {
    const unit = player.board.lanes[lane]?.unit;
    if (unit) unit.temp = freshUnitTemp();
  }
}

export function resetPlayerForNewGame(player, faction, deckChoiceId = null) {
  const name = player.name;
  const uid = player.uid;
  const connected = player.connected;
  const isBot = !!player.isBot;
  const aiDifficulty = player.aiDifficulty || null;
  const selectedDeckId = deckChoiceId || player.deckChoiceId || null;
  const seat = player.seat;
  const p = emptyPlayer(seat);
  p.uid = uid;
  p.name = name;
  p.connected = connected;
  p.isBot = isBot;
  p.aiDifficulty = aiDifficulty;
  p.ready = true;
  p.faction = faction;
  p.deckChoiceId = selectedDeckId;
  p.aurion = CONFIG.STARTING_AURION;
  p.volatileTributeBonus = 0;
  p.deck = buildSelectedDeck(faction, seat, selectedDeckId);
  p.battleplanDeck = shuffle(freshBattleplanDeck());
  drawCards(p, CONFIG.STARTING_HAND);
  return p;
}
