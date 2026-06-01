import { CONFIG } from '../core/config.js';
import { calculateAP, legalAttackTargets } from '../core/rules.js';

// This UID is used by the reducer exactly like a seated human player.
// The bot owns P2, so its actions pass this UID through the normal rules engine.
export const BOT_UID = '__LEGIONS_OF_VALOR_AI_BOT__';

// A tiny guard prevents the bot from clicking several actions at once while
// Firebase/local state is still updating after the previous action.
let scheduledKey = null;
let botThinking = false;

export function botDisplayName(difficulty = 'normal') {
  const label = String(difficulty || 'normal').toLowerCase();
  if (label === 'easy') return 'Training Garrison';
  if (label === 'hard') return 'Warlord Automaton';
  return 'Battlefield Captain';
}

export function botDelayFor(difficulty = 'normal') {
  const label = String(difficulty || 'normal').toLowerCase();
  // Short delays keep the bot from looking frozen. The pauses are only for readability.
  if (label === 'easy') return 350;
  if (label === 'hard') return 120;
  return 220;
}

// Called after every render. If it is currently the bot's turn, the bot chooses
// one legal mouse-style action and sends it through the same dispatcher that a
// real player uses. One action at a time keeps the game readable and debuggable.
export function maybeRunBot(room, roomCode, sendBotAction) {
  const state = room?.gameState;
  if (!state || state.status !== 'inGame') return;
  if (!state.players?.p2?.isBot) return;

  const needsBot = state.activePlayer === 'p2' || state.pendingAction?.player === 'p2' || state.pendingAction?.defender === 'p2';
  if (!needsBot) return;

  const key = [roomCode, state.version, state.phase, state.activePlayer, state.pendingAction?.type || 'none'].join('|');
  if (botThinking || scheduledKey === key) return;

  scheduledKey = key;
  botThinking = true;
  const difficulty = state.players.p2.aiDifficulty || state.ai?.difficulty || 'normal';

  window.setTimeout(async () => {
    try {
      const latest = room?.gameState;
      const action = chooseBotAction(latest, difficulty);
      if (action) {
        console.log('AI action:', action.type, action);
        await sendBotAction(action);
      } else {
        console.warn('AI had no legal action for current state:', latest?.phase, latest?.pendingAction);
      }
    } catch (err) {
      console.error('AI bot action failed:', err);
    } finally {
      botThinking = false;
      // Release the key slightly later so a Firebase listener can update first.
      window.setTimeout(() => { scheduledKey = null; }, 100);
    }
  }, botDelayFor(difficulty));
}

function chooseBotAction(state, difficulty) {
  if (!state || state.status !== 'inGame') return null;

  // Strategy Phase: choose one Battleplan from the modal choices.
  if (state.pendingAction?.type === 'chooseBattleplan' && state.pendingAction.player === 'p2') {
    const choices = state.players.p2.battleplanChoices || [];
    const chosen = chooseBattleplan(choices, difficulty);
    return chosen ? { type: 'SELECT_BATTLEPLAN', battleplanId: chosen.id } : null;
  }

  // Defensive Parry prompt: the bot either declines or discards a minimal set
  // of cards based on difficulty.
  if (state.pendingAction?.type === 'parry' && state.pendingAction.defender === 'p2') {
    const ids = chooseParryCards(state, difficulty);
    return ids.length ? { type: 'SUBMIT_PARRY', cardIds: ids } : { type: 'DECLINE_PARRY' };
  }

  if (state.activePlayer !== 'p2') return null;

  if (state.phase === 'deployment') return chooseDeploymentAction(state, difficulty);
  if (state.phase === 'conflict') return chooseConflictAction(state, difficulty);

  return null;
}

function chooseBattleplan(choices, difficulty) {
  if (!choices.length) return null;
  const label = String(difficulty || 'normal').toLowerCase();
  if (label === 'easy') return choices[0];

  const score = bp => {
    const drawWeight = label === 'hard' ? 2 : 1.4;
    const rewardWeight = label === 'hard' ? 1.4 : 1;
    return (bp.draw || 0) * drawWeight + (bp.reward || 0) * rewardWeight + (bp.maxHand || 0) * 0.15;
  };
  return [...choices].sort((a, b) => score(b) - score(a))[0];
}

function chooseParryCards(state, difficulty) {
  const label = String(difficulty || 'normal').toLowerCase();
  if (label === 'easy') return [];

  const pending = state.pendingAction;
  const hand = [...(state.players.p2.hand || [])].filter(c => (c.dp || 0) > 0);
  if (!hand.length) return [];

  const needed = Math.max(0, (pending.attackAP || 0) - (pending.baseDefendAP || 0) + 1);
  if (needed <= 0) return [];

  // Normal tries one good card. Hard tries the smallest combination that saves the unit.
  if (label === 'normal') {
    const single = hand.sort((a, b) => (a.dp || 0) - (b.dp || 0)).find(c => (c.dp || 0) >= needed);
    return single ? [single.instanceId] : [];
  }

  const sorted = hand.sort((a, b) => (a.dp || 0) - (b.dp || 0));
  const picked = [];
  let total = 0;
  for (const card of sorted) {
    picked.push(card.instanceId);
    total += card.dp || 0;
    if (total >= needed) break;
  }
  return total >= needed ? picked : [];
}

function chooseDeploymentAction(state, difficulty) {
  const bot = state.players.p2;
  const label = String(difficulty || 'normal').toLowerCase();

  // 1) Play the best affordable unit into a sensible empty lane.
  const emptyLanes = CONFIG.LANES.filter(lane => !bot.board.lanes[lane].unit);
  const units = bot.hand.filter(c => c.type === 'unit' && (c.cost || 0) <= bot.mana);
  if (emptyLanes.length && units.length) {
    const unit = chooseUnitToPlay(units, label);
    const lane = chooseLaneForUnit(state, unit, emptyLanes, label);
    return { type: 'PLAY_UNIT', cardId: unit.instanceId, lane };
  }

  // 2) Equip a friendly unit if the bot can afford equipment.
  const equipment = bot.hand.filter(c => c.type === 'equipment' && (c.cost || 0) <= bot.mana);
  if (equipment.length) {
    const target = chooseEquipmentTarget(bot);
    const equip = equipment.find(card => {
      const slot = card.equipmentSlot || 'weapon';
      return target && !target.unit.equipment?.[slot];
    });
    if (equip && target) return { type: 'PLAY_EQUIPMENT', cardId: equip.instanceId, lane: target.lane };
  }

  // 3) Normal/Hard bots may set one event/trap face-down as pressure.
  if (label !== 'easy') {
    const openBackrow = CONFIG.LANES.find(lane => !bot.board.backrow[lane]);
    const trap = bot.hand.find(c => c.type === 'eventTrap');
    const cost = 1 + CONFIG.LANES.filter(lane => bot.board.backrow[lane]).length;
    if (openBackrow && trap && bot.mana >= cost) {
      return { type: 'SET_FACE_DOWN', cardId: trap.instanceId, lane: openBackrow };
    }
  }

  return { type: 'END_DEPLOYMENT' };
}

function chooseUnitToPlay(units, difficulty) {
  if (difficulty === 'easy') return [...units].sort((a, b) => (a.cost || 0) - (b.cost || 0))[0];
  return [...units].sort((a, b) => unitScore(b) - unitScore(a))[0];
}

function unitScore(card) {
  return (card.ap || 0) * 2 + (card.dp || 0) + (card.elite ? 2.5 : 0) - (card.cost || 0) * 0.2;
}

function chooseLaneForUnit(state, unit, emptyLanes, difficulty) {
  const human = state.players.p1;
  if (difficulty === 'easy') return emptyLanes[0];

  // Prefer contesting an enemy unit that the new unit can beat. Otherwise center,
  // then side lanes for side-lane Aurion pressure.
  const winningLane = emptyLanes.find(lane => {
    const enemy = human.board.lanes[lane].unit;
    return enemy && (unit.ap || 0) > (enemy.ap || 0);
  });
  if (winningLane) return winningLane;
  if (emptyLanes.includes('center')) return 'center';
  return emptyLanes[0];
}

function chooseEquipmentTarget(bot) {
  return CONFIG.LANES
    .map(lane => ({ lane, unit: bot.board.lanes[lane].unit }))
    .filter(x => x.unit)
    .sort((a, b) => unitScore(b.unit) - unitScore(a.unit))[0] || null;
}

function chooseConflictAction(state, difficulty) {
  const bot = state.players.p2;
  const label = String(difficulty || 'normal').toLowerCase();

  const attackers = CONFIG.LANES
    .map(lane => ({ lane, unit: bot.board.lanes[lane].unit }))
    .filter(x => x.unit && !x.unit.temp?.hasAttacked && !x.unit.temp?.cannotAttack);

  if (!attackers.length) return { type: 'END_CONFLICT' };

  const ranked = attackers.sort((a, b) => {
    const aAp = calculateAP(state, 'p2', a.lane, 'attack');
    const bAp = calculateAP(state, 'p2', b.lane, 'attack');
    return bAp - aAp;
  });

  const attacker = label === 'easy' ? attackers[0] : ranked[0];
  const targets = legalAttackTargets(attacker.unit, attacker.lane);
  const targetLane = chooseAttackTarget(state, attacker, targets, label);
  const enemyBackrow = !!state.players.p1.board.backrow[targetLane];
  const style = enemyBackrow && label !== 'easy' ? 'cautious' : 'commit';
  return { type: 'DECLARE_ATTACK', fromLane: attacker.lane, toLane: targetLane, strikeStyle: style };
}

function chooseAttackTarget(state, attacker, targets, difficulty) {
  const human = state.players.p1;
  if (difficulty === 'easy') return targets[0];

  const scored = targets.map(lane => {
    const enemy = human.board.lanes[lane].unit;
    const attackAp = calculateAP(state, 'p2', attacker.lane, 'attack');
    if (!enemy) return { lane, score: difficulty === 'hard' ? 4 : 2 };
    const enemyAp = calculateAP(state, 'p1', lane, 'defense');
    const winScore = attackAp > enemyAp ? 8 : attackAp === enemyAp ? 3 : -3;
    const eliteBonus = enemy.elite ? 2 : 0;
    return { lane, score: winScore + eliteBonus - (enemy.dp || 0) * 0.1 };
  });
  return scored.sort((a, b) => b.score - a.score)[0]?.lane || targets[0];
}
