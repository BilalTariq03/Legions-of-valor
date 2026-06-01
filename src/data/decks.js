import { CARD_DATABASE, FACTIONS } from './cards.js';
import { shuffle } from '../core/utils.js';

// Deck storage is intentionally browser-local for now.
// Online multiplayer sends the chosen deck id through the room state.
// Custom decks are stored in localStorage on the computer that created them.
// Later, this can be replaced with Firebase user profiles.
export const DECK_SIZE = 30;
export const CUSTOM_DECK_STORAGE_KEY = 'lovCustomDecksV1';

const DEFAULT_DECK_NAMES = {
  Elves: 'Mistwood Ambush',
  Humans: 'Aurion Vanguard',
  Orcs: 'Blood-Pit Assault',
  Dwarves: 'Karak-Duun Bulwark'
};

const SHARED_EVENT_IDS = [
  'supply_convoy',
  'wildfires',
  'rain_of_volleys',
  'chain_down',
  'overrun'
];

function byScore(card) {
  return (card.ap || 0) * 2 + (card.dp || 0) + (card.elite ? 3 : 0) - (card.cost || 0) * 0.15;
}

function addCopies(out, card, copies, maxSize = DECK_SIZE) {
  if (!card) return;
  const limit = card.elite ? 1 : Math.min(2, copies);
  for (let i = 0; i < limit && out.length < maxSize; i++) out.push(card.id);
}

function defaultEquipmentIds() {
  return CARD_DATABASE
    .filter(c => c.type === 'equipment')
    .sort((a, b) => (a.cost || 0) - (b.cost || 0) || byScore(b) - byScore(a))
    .slice(0, 5)
    .map(c => c.id);
}

export function makeBalancedDefaultDeck(faction) {
  const units = CARD_DATABASE.filter(c => c.type === 'unit' && c.faction === faction);
  const cheap = units.filter(c => (c.cost || 0) <= 2 && !c.elite).sort((a, b) => byScore(b) - byScore(a));
  const mid = units.filter(c => (c.cost || 0) >= 3 && (c.cost || 0) <= 4 && !c.elite).sort((a, b) => byScore(b) - byScore(a));
  const heavy = units.filter(c => (c.cost || 0) >= 5).sort((a, b) => byScore(b) - byScore(a));
  const cardIds = [];

  // 20 faction units: early plays, mid-game bodies, and a few elite/high-cost finishers.
  for (const c of cheap.slice(0, 4)) addCopies(cardIds, c, 2, 20);
  for (const c of mid.slice(0, 4)) addCopies(cardIds, c, 2, 20);
  for (const c of heavy.slice(0, 6)) addCopies(cardIds, c, c.elite ? 1 : 1, 20);
  let safety = 0;
  while (cardIds.length < 20 && units.length && safety < 100) {
    addCopies(cardIds, units[safety % units.length], 1, 20);
    safety++;
  }

  // 5 flexible events/traps and 5 equipment pieces.
  for (const id of SHARED_EVENT_IDS) if (cardIds.length < 25) cardIds.push(id);
  for (const id of defaultEquipmentIds()) if (cardIds.length < DECK_SIZE) cardIds.push(id);

  // Emergency pad if future card lists change.
  safety = 0;
  while (cardIds.length < DECK_SIZE && units.length && safety < 100) {
    cardIds.push(units[safety % units.length].id);
    safety++;
  }

  return {
    id: `default_${String(faction).toLowerCase()}`,
    name: DEFAULT_DECK_NAMES[faction] || `${faction} Default Deck`,
    faction,
    isDefault: true,
    cardIds: cardIds.slice(0, DECK_SIZE)
  };
}

export function getDefaultDecks() {
  return FACTIONS.map(makeBalancedDefaultDeck);
}

export function loadCustomDecks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_DECK_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(isValidDeckShape) : [];
  } catch (_) {
    return [];
  }
}

export function saveCustomDecks(decks) {
  localStorage.setItem(CUSTOM_DECK_STORAGE_KEY, JSON.stringify(decks.filter(isValidDeckShape)));
}

export function saveCustomDeck(deck) {
  if (!isValidDeckShape(deck)) throw new Error('Deck must have a name, faction, and exactly 30 cards.');
  const decks = loadCustomDecks().filter(d => d.id !== deck.id);
  decks.push(deck);
  saveCustomDecks(decks);
  return deck;
}

export function deleteCustomDeck(id) {
  saveCustomDecks(loadCustomDecks().filter(d => d.id !== id));
}

export function getAllDecks() {
  return [...getDefaultDecks(), ...loadCustomDecks()];
}

export function getDecksForFaction(faction) {
  return getAllDecks().filter(d => d.faction === faction);
}

export function getDeckDefinition(deckId, faction) {
  const decks = getAllDecks();
  const found = decks.find(d => d.id === deckId && (!faction || d.faction === faction));
  return found || makeBalancedDefaultDeck(faction || 'Humans');
}

export function createDeckInstances(deckDefinition, owner, instantiateCard) {
  const templatesById = new Map(CARD_DATABASE.map(c => [c.id, c]));
  const instances = [];
  for (const id of deckDefinition.cardIds || []) {
    const template = templatesById.get(id);
    if (template) instances.push(instantiateCard(template, owner));
  }
  return shuffle(instances).slice(0, DECK_SIZE);
}

export function randomFaction(except = '') {
  const choices = FACTIONS.filter(f => f !== except);
  return choices[Math.floor(Math.random() * choices.length)] || FACTIONS[0];
}

export function isValidDeckShape(deck) {
  return !!deck
    && typeof deck.id === 'string'
    && typeof deck.name === 'string'
    && FACTIONS.includes(deck.faction)
    && Array.isArray(deck.cardIds)
    && deck.cardIds.length === DECK_SIZE;
}

export function cardTemplateById(id) {
  return CARD_DATABASE.find(c => c.id === id) || null;
}
