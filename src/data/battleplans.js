// Battleplans from the Battleplans tab.

export const BATTLEPLANS = [
  {
    "id": "vanguards_push",
    "name": "Vanguard’s Push",
    "draw": 4,
    "maxHand": 5,
    "tacticalObjective": "Equip: Have at least 2 pieces of Equipment active on your units at turn end.",
    "reward": 3
  },
  {
    "id": "the_iron_shield",
    "name": "The Iron Shield",
    "draw": 2,
    "maxHand": 9,
    "tacticalObjective": "Deflect: Successfully win a Clash using a Parry Chain (2+ cards).",
    "reward": 3
  },
  {
    "id": "cunning_ambush",
    "name": "Cunning Ambush",
    "draw": 3,
    "maxHand": 6,
    "tacticalObjective": "Ensnare: Successfully trigger a Tactic (Trap) by an opponent's \"Commit\".",
    "reward": 3
  },
  {
    "id": "wide_frontage",
    "name": "Wide Frontage",
    "draw": 5,
    "maxHand": 6,
    "tacticalObjective": "Dominance: Control both side lanes (Higher AP than opponent) at turn end.",
    "reward": 2
  },
  {
    "id": "master_scout",
    "name": "Master Scout",
    "draw": 4,
    "maxHand": 5,
    "tacticalObjective": "Expose: Reveal a face-down card using an Ability or Caution.",
    "reward": 2
  },
  {
    "id": "tactical_reserve",
    "name": "Tactical Reserve",
    "draw": 2,
    "maxHand": 8,
    "tacticalObjective": "Logistics: End your turn with at least 3 Mana remaining.",
    "reward": 2
  },
  {
    "id": "the_grand_ruse",
    "name": "The Grand Ruse",
    "draw": 3,
    "maxHand": 7,
    "tacticalObjective": "Deception: Have the opponent use Caution on a Ruse (Unit or Equipment).",
    "reward": 2
  },
  {
    "id": "high_command",
    "name": "High Command",
    "draw": 3,
    "maxHand": 7,
    "tacticalObjective": "Leadership: Deploy an Elite unit (Mana 4+) this turn.",
    "reward": 3
  },
  {
    "id": "total_war",
    "name": "Total War",
    "draw": 5,
    "maxHand": 6,
    "tacticalObjective": "Commit: Declare an attack in all 3 lanes during the Conflict Phase.",
    "reward": 3
  },
  {
    "id": "last_stand",
    "name": "Last Stand",
    "draw": 1,
    "maxHand": 10,
    "tacticalObjective": "Fortify: Do not lose any units during the opponent’s next Conflict Phase.",
    "reward": 3
  }
];

export function freshBattleplanDeck() {
  return BATTLEPLANS.map(bp => ({ ...bp }));
}
