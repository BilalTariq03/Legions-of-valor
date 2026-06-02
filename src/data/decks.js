import { CARD_DATABASE, FACTIONS } from './cards.js';
import { shuffle } from '../core/utils.js';

// Deck storage is intentionally browser-local for now.
// Online multiplayer sends the chosen deck id through the room state.
// Custom decks are stored in localStorage on the computer that created them.
// Later, this can be replaced with Firebase user profiles.
export const DECK_SIZE = 50;
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

  // ~34 faction units: fill out with 2 copies of each available unit.
  for (const c of cheap) addCopies(cardIds, c, 2, 34);
  for (const c of mid) addCopies(cardIds, c, 2, 34);
  for (const c of heavy) addCopies(cardIds, c, 2, 34);
  let safety = 0;
  while (cardIds.length < 34 && units.length && safety < 200) {
    addCopies(cardIds, units[safety % units.length], 1, 34);
    safety++;
  }

  // 8 events/traps and 8 equipment pieces to fill to 50.
  const events = CARD_DATABASE.filter(c => c.type === 'eventTrap').sort((a, b) => byScore(b) - byScore(a));
  const equipment = CARD_DATABASE.filter(c => c.type === 'equipment').sort((a, b) => (a.cost || 0) - (b.cost || 0));
  for (const id of SHARED_EVENT_IDS) if (cardIds.length < 42) cardIds.push(id);
  for (const c of events) if (cardIds.length < 42) cardIds.push(c.id);
  for (const id of defaultEquipmentIds()) if (cardIds.length < 50) cardIds.push(id);
  for (const c of equipment) if (cardIds.length < DECK_SIZE) cardIds.push(c.id);

  // Emergency pad.
  safety = 0;
  while (cardIds.length < DECK_SIZE && units.length && safety < 200) {
    cardIds.push(units[safety % units.length].id);
    safety++;
  }

  return {
    id: `default_${String(faction).toLowerCase()}`,
    name: DEFAULT_DECK_NAMES[faction] || `${faction} Default Deck`,
    faction,
    factions: [faction],
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
  if (!isValidDeckShape(deck)) throw new Error(`Deck must have a name, faction, and exactly ${DECK_SIZE} cards.`);
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
  return getAllDecks().filter(d => {
    if (Array.isArray(d.factions)) return d.factions.includes(faction);
    return d.faction === faction;
  });
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
  return shuffle(instances);
}

export function randomFaction(except = '') {
  const choices = FACTIONS.filter(f => f !== except);
  return choices[Math.floor(Math.random() * choices.length)] || FACTIONS[0];
}

export function isValidDeckShape(deck) {
  const factionOk = deck.faction && (FACTIONS.includes(deck.faction)
    || (Array.isArray(deck.factions) && deck.factions.every(f => FACTIONS.includes(f))));
  return !!deck
    && typeof deck.id === 'string'
    && typeof deck.name === 'string'
    && !!factionOk
    && Array.isArray(deck.cardIds)
    && deck.cardIds.length === DECK_SIZE;
}

export function cardTemplateById(id) {
  return CARD_DATABASE.find(c => c.id === id) || null;
}
