import { CONFIG } from './config.js';
import { buildPresetDeck, drawCards, freshTurnFlags, resetPlayerForNewGame } from './game-state.js';
import { deepClone, otherPlayer, safeName, shuffle, titleCaseLane } from './utils.js';
import {
  addLog, errorState, clearError, findSeatByUid, effectivePlayCost, faceDownCost,
  removeFromHand, onDeployAbilities, applyEventEffect, calculateAP, hasAbility,
  legalAttackTargets, killUnit, awardKillAurion, triggerOnWinAbilities,
  triggerMonarchStrike, scoreEndOfTurn, checkWinner, prepareStrategyPhase,
  resetTurnTemporaryEffects
} from './rules.js';

export function reduceGameState(inputState, action, actorUid) {
  const state = clearError(deepClone(inputState));
  // Prototype multiplayer seat hint. This helps when Firebase anonymous UID changes
  // between browser sessions; actions still must be legal for the current phase/turn.
  state._actorSeatHint = action?.seat || null;
  state.version = (state.version || 0) + 1;

  try {
    let result;
    switch (action.type) {
      case 'CLAIM_SEAT': result = claimSeat(state, action, actorUid); break;
      case 'UPDATE_NAME': result = updateName(state, action, actorUid); break;
      case 'SELECT_FACTION': result = selectFaction(state, action, actorUid); break;
      case 'SELECT_DECK': result = selectDeck(state, action, actorUid); break;
      case 'READY_PLAYER': result = readyPlayer(state, action, actorUid); break;
      case 'START_GAME': result = startGame(state, action, actorUid); break;
      case 'SELECT_BATTLEPLAN': result = selectBattleplan(state, action, actorUid); break;
      case 'PLAY_UNIT': result = playUnit(state, action, actorUid); break;
      case 'PLAY_EQUIPMENT': result = playEquipment(state, action, actorUid); break;
      case 'PLAY_EVENT': result = playEvent(state, action, actorUid); break;
      case 'SET_FACE_DOWN': result = setFaceDown(state, action, actorUid); break;
      case 'END_DEPLOYMENT': result = endDeployment(state, action, actorUid); break;
      case 'DECLARE_ATTACK': result = declareAttack(state, action, actorUid); break;
      case 'SUBMIT_PARRY': result = submitParry(state, action, actorUid); break;
      case 'DECLINE_PARRY': result = declineParry(state, action, actorUid); break;
      case 'ACTIVATE_ABILITY': result = activateAbility(state, action, actorUid); break;
      case 'END_CONFLICT': result = endConflict(state, action, actorUid); break;
      case 'CONCEDE': result = concede(state, action, actorUid); break;
      case 'REMATCH': result = rematch(state, action, actorUid); break;
      default:
        result = errorState(state, `Unknown action: ${action.type}`); break;
    }
    if (result && typeof result === 'object') delete result._actorSeatHint;
    return result;
  } catch (err) {
    console.error(err);
    const result = errorState(state, err.message || 'Unexpected rules error.');
    delete result._actorSeatHint;
    return result;
  }
}

function actorSeat(state, uid) {
  const found = findSeatByUid(state, uid);
  if (found) return found;
  const hint = state._actorSeatHint;
  if (hint && ['p1', 'p2'].includes(hint)) return hint;
  return null;
}

function requireActor(state, uid) {
  const seat = actorSeat(state, uid);
  if (!seat) throw new Error('You are not seated in this room.');
  return seat;
}

function requireTurn(state, uid) {
  const seat = requireActor(state, uid);
  if (seat !== state.activePlayer) throw new Error('It is not your turn.');
  return seat;
}

function claimSeat(state, action, uid) {
  const wanted = action.seat;
  if (!['p1', 'p2'].includes(wanted)) return errorState(state, 'Invalid seat.');

  // IMPORTANT ONLINE FIX:
  // Do NOT use actorSeat() here. actorSeat() is allowed to trust action.seat as
  // a fallback hint for normal actions, but during CLAIM_SEAT that hint is the
  // seat being requested, not proof that the browser already owns it.
  // The old code used actorSeat(), so when Player 2 joined with seat='p2' it
  // thought Player 2 already owned P2 and only changed the name/connected flag,
  // leaving p2.uid empty. That is why both laptops kept seeing P2 as Empty Seat.
  const existing = findSeatByUid(state, uid);
  if (existing) {
    state.players[existing].connected = true;
    state.players[existing].name = safeName(action.name || state.players[existing].name);
    addLog(state, `${state.players[existing].name} reconnected.`);
    return state;
  }

  if (state.players[wanted].uid && state.players[wanted].uid !== uid) return errorState(state, 'That seat is already taken.');
  state.players[wanted].uid = uid;
  state.players[wanted].connected = true;
  state.players[wanted].name = safeName(action.name);
  addLog(state, `${state.players[wanted].name} claimed ${wanted.toUpperCase()}.`);
  return state;
}

function updateName(state, action, uid) {
  const seat = requireActor(state, uid);
  state.players[seat].name = safeName(action.name);
  return state;
}

function selectFaction(state, action, uid) {
  const seat = requireActor(state, uid);
  if (state.status !== 'lobby') return errorState(state, 'Faction can only be selected in lobby.');
  if (!['Elves', 'Humans', 'Orcs', 'Dwarves'].includes(action.faction)) return errorState(state, 'Invalid faction.');
  state.players[seat].faction = action.faction;
  state.players[seat].deckChoiceId = `default_${String(action.faction).toLowerCase()}`;
  state.players[seat].ready = false;
  addLog(state, `${state.players[seat].name} selected ${action.faction}.`);
  return state;
}


function selectDeck(state, action, uid) {
  const seat = requireActor(state, uid);
  if (state.status !== 'lobby') return errorState(state, 'Deck can only be selected in lobby.');
  const deckId = String(action.deckId || '').trim();
  if (!deckId) return errorState(state, 'Invalid deck selection.');
  state.players[seat].deckChoiceId = deckId;
  state.players[seat].ready = false;
  addLog(state, `${state.players[seat].name} selected a deck.`);
  return state;
}

function readyPlayer(state, action, uid) {
  // Normally the Firebase anonymous auth UID identifies which seat is clicking.
  // The explicit seat is only used as a safe fallback for local/LAN testing when
  // a browser refresh or auth delay makes the current UID unavailable for a moment.
  let seat = actorSeat(state, uid);
  if (!seat && action.seat && ['p1', 'p2'].includes(action.seat)) {
    seat = action.seat;
  }
  if (!seat) return errorState(state, 'You are not seated in this room. Return to title and rejoin the room.');
  if (!state.players[seat].faction) return errorState(state, 'Choose a faction first.');

  state.players[seat].ready = !!action.ready;
  addLog(state, `${state.players[seat].name} is ${action.ready ? 'ready' : 'not ready'}.`);

  // IMPORTANT ONLINE HANDSHAKE FIX:
  // Ready no longer starts the duel inside this same click. Earlier builds did
  // that on the second Ready click, so the button had to save a much larger
  // full game state with shuffled decks. If that write stalled or failed, the
  // UI looked broken: one player was ready, the second button stayed on
  // "Readying...", and neither player could cleanly unready.
  //
  // Now Ready only saves the small lobby flag. After both players are ready,
  // Player 1's browser starts the duel as a separate action from the room
  // listener. This keeps ready/unready reliable and prevents the second ready
  // click from carrying all of the game-start work.
  return state;
}

function startGame(state, action, uid, fromReady = false) {
  if (state.status !== 'lobby') return state;
  if (!fromReady && !action?.force) requireActor(state, uid);
  if (!state.players.p1.uid || !state.players.p2.uid) return errorState(state, 'Both seats must be filled.');
  if (!state.players.p1.faction || !state.players.p2.faction) return errorState(state, 'Both players must choose factions.');
  if (action?.force) {
    state.players.p1.ready = true;
    state.players.p2.ready = true;
    addLog(state, 'Start Duel Now was used. Both players were marked ready.');
  }
  if (!state.players.p1.ready || !state.players.p2.ready) return errorState(state, 'Both players must be ready.');

  const p1Faction = state.players.p1.faction;
  const p2Faction = state.players.p2.faction;
  state.players.p1 = resetPlayerForNewGame(state.players.p1, p1Faction, state.players.p1.deckChoiceId);
  state.players.p2 = resetPlayerForNewGame(state.players.p2, p2Faction, state.players.p2.deckChoiceId);
  state.status = 'inGame';
  state.phase = 'strategy';
  state.activePlayer = 'p1';
  state.turnNumber = 1;
  state.winner = null;
  state.pendingAction = null;
  state.noParryUntilTurnEnd = false;
  addLog(state, 'The duel begins. Player 1 takes the first Strategy Phase.');
  prepareStrategyPhase(state, 'p1');
  return state;
}

function selectBattleplan(state, action, uid) {
  const seat = requireTurn(state, uid);
  const player = state.players[seat];
  if (state.phase !== 'strategy' || state.pendingAction?.type !== 'chooseBattleplan') return errorState(state, 'No Battleplan choice is pending.');
  const chosen = player.battleplanChoices.find(bp => bp.id === action.battleplanId);
  if (!chosen) return errorState(state, 'Invalid Battleplan.');

  const rejected = player.battleplanChoices.filter(bp => bp.id !== chosen.id);
  player.battleplanDeck.push(...rejected);
  player.currentBattleplan = chosen;
  player.battleplanChoices = [];
  player.mana = CONFIG.BASE_MANA_PER_TURN;
  player.turnFlags = freshTurnFlags();
  resetTurnTemporaryEffects(state);

  const bonus = player.momentumDrawBonus || 0;
  player.momentumDrawBonus = 0;
  const amount = chosen.draw + bonus;
  drawCards(player, amount);
  addLog(state, `${player.name} chose ${chosen.name} and drew ${amount} card(s).`);
  state.phase = 'deployment';
  state.pendingAction = null;
  return state;
}

function playUnit(state, action, uid) {
  const seat = requireTurn(state, uid);
  if (state.phase !== 'deployment') return errorState(state, 'Units can only be played during Deployment.');
  const player = state.players[seat];
  const card = player.hand.find(c => c.instanceId === action.cardId);
  if (!card || card.type !== 'unit') return errorState(state, 'Select a unit card from your hand.');
  const lane = action.lane;
  if (!CONFIG.LANES.includes(lane)) return errorState(state, 'Invalid lane.');
  if (player.board?.lanes?.[lane]?.unit) return errorState(state, 'That lane already has a unit.');
  const cost = effectivePlayCost(state, seat, card, lane);
  if (player.mana < cost) return errorState(state, 'Not enough Mana.');

  const unit = removeFromHand(player, card.instanceId);
  player.mana -= cost;
  unit.temp = unit.temp || {};
  unit.equipment = unit.equipment || { weapon: null, armor: null };
  player.board.lanes[lane].unit = unit;
  if (unit.elite) player.turnFlags.deployedElite = true;
  addLog(state, `${player.name} deployed ${unit.name} to ${titleCaseLane(lane)}.`);
  onDeployAbilities(state, seat, lane, unit);
  checkWinner(state);
  return state;
}

function playEquipment(state, action, uid) {
  const seat = requireTurn(state, uid);
  if (state.phase !== 'deployment') return errorState(state, 'Equipment can only be played during Deployment.');
  const player = state.players[seat];
  const card = player.hand.find(c => c.instanceId === action.cardId);
  if (!card || card.type !== 'equipment') return errorState(state, 'Select equipment from your hand.');
  const lane = action.lane;
  const unit = player.board.lanes[lane]?.unit;
  if (!unit) return errorState(state, 'Choose a friendly unit to equip.');
  const slot = card.equipmentSlot || 'weapon';
  if (unit.equipment?.[slot]) return errorState(state, `That unit already has ${slot}.`);
  if (player.mana < card.cost) return errorState(state, 'Not enough Mana.');
  const eq = removeFromHand(player, card.instanceId);
  player.mana -= eq.cost;
  unit.equipment[slot] = eq;
  addLog(state, `${player.name} equipped ${unit.name} with ${eq.name}.`);
  return state;
}

function setFaceDown(state, action, uid) {
  const seat = requireTurn(state, uid);
  if (state.phase !== 'deployment') return errorState(state, 'Face-down cards are set during Deployment.');
  const player = state.players[seat];
  const card = player.hand.find(c => c.instanceId === action.cardId);
  if (!card) return errorState(state, 'Select a card from your hand.');
  if (card.exposed) return errorState(state, 'Exposed cards cannot be set face-down again.');
  const lane = action.lane;
  if (!CONFIG.LANES.includes(lane)) return errorState(state, 'Invalid lane.');
  if (player.board?.backrow?.[lane]) return errorState(state, 'That Back Row slot is occupied.');
  const cost = faceDownCost(player);
  if (player.mana < cost) return errorState(state, 'Not enough Mana to set face-down.');
  const hidden = removeFromHand(player, card.instanceId);
  player.mana -= cost;
  player.board.backrow[lane] = {
    instanceId: hidden.instanceId,
    owner: seat,
    card: hidden,
    kind: hidden.type === 'eventTrap' ? 'trap' : 'ruse',
    revealed: false
  };
  addLog(state, `${player.name} set a face-down card in ${titleCaseLane(lane)}.`);
  return state;
}

function playEvent(state, action, uid) {
  const seat = requireTurn(state, uid);
  if (state.phase !== 'deployment') return errorState(state, 'Events can currently be played during Deployment.');
  const player = state.players[seat];
  const card = player.hand.find(c => c.instanceId === action.cardId);
  if (!card || card.type !== 'eventTrap') return errorState(state, 'Select an Event/Trap from your hand.');
  if (player.mana < card.cost) return errorState(state, 'Not enough Mana.');
  const event = removeFromHand(player, card.instanceId);
  player.mana -= event.cost;
  const ok = applyEventEffect(state, seat, event, action.targetLane);
  player.discard.push(event);
  if (!ok) return errorState(state, `${event.name} could not resolve.`);
  checkWinner(state);
  return state;
}

function endDeployment(state, action, uid) {
  const seat = requireTurn(state, uid);
  if (state.phase !== 'deployment') return errorState(state, 'Not in Deployment.');
  state.phase = 'conflict';
  state.pendingAction = null;
  addLog(state, `${state.players[seat].name} entered Conflict Phase.`);
  return state;
}

function declareAttack(state, action, uid) {
  const seat = requireTurn(state, uid);
  if (state.phase !== 'conflict') return errorState(state, 'Attacks happen during Conflict.');
  if (state.pendingAction) return errorState(state, 'Resolve the pending action first.');

  const attacker = state.players[seat];
  const defenderKey = otherPlayer(seat);
  const defender = state.players[defenderKey];
  const fromLane = action.fromLane;
  const toLane = action.toLane;
  const strikeStyle = action.strikeStyle || 'commit';
  const attackingUnit = attacker.board.lanes[fromLane]?.unit;
  if (!attackingUnit) return errorState(state, 'No attacking unit in that lane.');
  if (attackingUnit.temp.hasAttacked) return errorState(state, 'That unit has already attacked.');
  if (attackingUnit.temp.cannotAttack) return errorState(state, 'That unit cannot attack this turn.');
  if (!legalAttackTargets(attackingUnit, fromLane).includes(toLane)) return errorState(state, 'That unit cannot target that lane.');

  attacker.turnFlags.attacksDeclaredByLane = [...new Set([...(attacker.turnFlags.attacksDeclaredByLane || []), fromLane])];
  attackingUnit.temp.hasAttacked = true;

  // Backrow interaction belongs to the defending player in the target lane.
  const back = defender.board.backrow[toLane];
  if (back) {
    if (strikeStyle === 'cautious') {
      defender.board.backrow[toLane] = null;
      attacker.turnFlags.revealedFaceDown = true;
      if (back.kind === 'ruse') {
        back.card.exposed = true;
        defender.hand.push(back.card);
        defender.aurion += 1;
        defender.turnFlags.ruseSucceeded = true;
        addLog(state, `${attacker.name} used Cautious Strike on a Ruse. ${defender.name} gained +1 Aurion.`);
      } else {
        defender.discard.push(back.card);
        addLog(state, `${attacker.name} safely disarmed ${back.card.name} with Cautious Strike.`);
      }
    } else if (strikeStyle === 'commit' && !hasAbility(attackingUnit, 'Infiltrator')) {
      defender.board.backrow[toLane] = null;
      if (back.kind === 'trap') {
        defender.turnFlags.triggeredTrap = true;
        applyEventEffect(state, defenderKey, back.card, fromLane);
        defender.discard.push(back.card);
        addLog(state, `${back.card.name} triggered against ${attackingUnit.name}.`);
      } else {
        defender.discard.push(back.card);
        addLog(state, `${attacker.name} committed through a Ruse. No Ruse reward was gained.`);
      }
    }
  }

  const defendingUnit = defender.board.lanes[toLane]?.unit;
  if (!defendingUnit) {
    triggerMonarchStrike(state, seat, attackingUnit);
    addLog(state, `${attackingUnit.name} made a Monarch Strike into ${titleCaseLane(toLane)}.`);
    checkWinner(state);
    return state;
  }

  const attackAP = Math.max(0, calculateAP(state, seat, fromLane, 'attack') - (strikeStyle === 'cautious' ? CONFIG.CAUTIOUS_STRIKE_AP_PENALTY : 0));
  const defendAP = calculateAP(state, defenderKey, toLane, 'defense');
  const defenderWouldDie = attackAP > defendAP;
  const parryPrevented = state.noParryUntilTurnEnd || hasAbility(attackingUnit, 'Swift') || hasAbility(defendingUnit, 'Swift') || (hasAbility(attackingUnit, 'Dominance') && attackAP >= defendAP + 3);

  if (defenderWouldDie && !parryPrevented && defender.hand.length > 0) {
    state.pendingAction = {
      type: 'parry',
      attacker: seat,
      defender: defenderKey,
      fromLane,
      toLane,
      strikeStyle,
      attackAP,
      baseDefendAP: defendAP
    };
    addLog(state, `${defender.name} may Parry against ${attackingUnit.name}.`);
    return state;
  }

  resolveClash(state, {
    attacker: seat, defender: defenderKey, fromLane, toLane, strikeStyle, attackAP, defendAP, parryCardIds: []
  });
  checkWinner(state);
  return state;
}

function submitParry(state, action, uid) {
  const seat = requireActor(state, uid);
  const pending = state.pendingAction;
  if (!pending || pending.type !== 'parry') return errorState(state, 'No Parry is pending.');
  if (seat !== pending.defender) return errorState(state, 'Only the defender may Parry.');
  const defender = state.players[seat];
  const ids = action.cardIds || [];
  let parryDP = 0;
  const used = [];
  for (const id of ids) {
    const card = defender.hand.find(c => c.instanceId === id);
    if (card) {
      parryDP += card.dp || 0;
      used.push(card);
    }
  }
  for (const card of used) {
    removeFromHand(defender, card.instanceId);
    defender.discard.push(card);
  }
  const finalDefendAP = pending.baseDefendAP + parryDP;
  addLog(state, `${defender.name} parried with ${used.length} card(s), adding ${parryDP} DP.`);
  resolveClash(state, { ...pending, defendAP: finalDefendAP, parryCardIds: ids });
  if (ids.length >= 2) {
    // The flag is finally set if defender survives/wins inside resolve preview. This approximation rewards successful heavy parries.
    defender.turnFlags.usedParryChainTwoPlusToWin = true;
  }
  state.pendingAction = null;
  checkWinner(state);
  return state;
}

function declineParry(state, action, uid) {
  const seat = requireActor(state, uid);
  const pending = state.pendingAction;
  if (!pending || pending.type !== 'parry') return errorState(state, 'No Parry is pending.');
  if (seat !== pending.defender) return errorState(state, 'Only the defender may decline Parry.');
  addLog(state, `${state.players[seat].name} declined to Parry.`);
  resolveClash(state, { ...pending, defendAP: pending.baseDefendAP, parryCardIds: [] });
  state.pendingAction = null;
  checkWinner(state);
  return state;
}

function resolveClash(state, context) {
  const { attacker, defender, fromLane, toLane, attackAP, defendAP } = context;
  const attackingPlayer = state.players[attacker];
  const defendingPlayer = state.players[defender];
  const attackingUnit = attackingPlayer.board.lanes[fromLane].unit;
  const defendingUnit = defendingPlayer.board.lanes[toLane].unit;
  if (!attackingUnit || !defendingUnit) return;

  addLog(state, `${attackingUnit.name} (${attackAP} AP) clashed with ${defendingUnit.name} (${defendAP} AP).`);

  const equalizerKillsBoth = hasAbility(defendingUnit, 'Equalizer') && attackAP > defendAP && attackAP <= defendAP + 2;
  if (attackAP > defendAP && !equalizerKillsBoth) {
    const killed = killUnit(state, defender, toLane, 'clash', attacker, true);
    awardKillAurion(state, attacker, killed);
    triggerOnWinAbilities(state, attacker, attackingUnit, defender);
  } else if (defendAP > attackAP) {
    const killed = killUnit(state, attacker, fromLane, 'clash', defender, true);
    awardKillAurion(state, defender, killed);
    triggerOnWinAbilities(state, defender, defendingUnit, attacker);
  } else {
    const killedDefender = killUnit(state, defender, toLane, 'tie', attacker, true);
    const killedAttacker = killUnit(state, attacker, fromLane, 'tie', defender, true);
    awardKillAurion(state, attacker, killedDefender);
    awardKillAurion(state, defender, killedAttacker);
    addLog(state, 'The Clash ended in mutual destruction.');
  }

  if (hasAbility(defendingUnit, 'Spiked') && !defendingPlayer.board.lanes[toLane].unit) {
    const killed = killUnit(state, attacker, fromLane, 'spiked', defender, true);
    awardKillAurion(state, defender, killed);
    addLog(state, `${defendingUnit.name}'s Spiked ability destroyed the attacker.`);
  }
  if (hasAbility(attackingUnit, 'Delirium') && attackingUnit.temp.usedDelirium) {
    killUnit(state, attacker, fromLane, 'delirium');
  }
}

function activateAbility(state, action, uid) {
  const seat = requireTurn(state, uid);
  if (state.phase !== 'conflict' && state.phase !== 'deployment') return errorState(state, 'Abilities are used during Deployment or Conflict.');
  const player = state.players[seat];
  const unit = player.board.lanes[action.lane]?.unit;
  if (!unit) return errorState(state, 'No unit in that lane.');
  if (unit.temp.cannotUseAbility) return errorState(state, 'This unit cannot use abilities this turn.');

  if (hasAbility(unit, 'Energy Cycle')) {
    const targetLane = action.targetLane;
    if (!targetLane || !CONFIG.LANES.includes(targetLane)) return errorState(state, 'Choose an adjacent friendly lane.');
    const idx = CONFIG.LANES.indexOf(action.lane);
    const targetIdx = CONFIG.LANES.indexOf(targetLane);
    if (Math.abs(idx - targetIdx) !== 1) return errorState(state, 'Energy Cycle targets adjacent lanes only.');
    const target = player.board.lanes[targetLane].unit;
    if (!target) return errorState(state, 'No friendly unit in target lane.');
    unit.temp.hasAttacked = true;
    target.temp.apMod += 2;
    addLog(state, `${unit.name} used Energy Cycle: ${target.name} gains +2 AP this turn.`);
    return state;
  }

  if (hasAbility(unit, 'Lane Shift')) {
    const targetLane = action.targetLane;
    if (!targetLane || player.board.lanes[targetLane].unit) return errorState(state, 'Choose an empty adjacent lane.');
    const idx = CONFIG.LANES.indexOf(action.lane);
    const targetIdx = CONFIG.LANES.indexOf(targetLane);
    if (Math.abs(idx - targetIdx) !== 1) return errorState(state, 'Lane Shift moves to adjacent lanes only.');
    player.board.lanes[targetLane].unit = unit;
    player.board.lanes[action.lane].unit = null;
    addLog(state, `${unit.name} shifted to ${titleCaseLane(targetLane)}.`);
    return state;
  }

  addLog(state, `${unit.name}'s active ability is not implemented yet.`);
  return state;
}

function endConflict(state, action, uid) {
  const seat = requireTurn(state, uid);
  if (state.phase !== 'conflict') return errorState(state, 'Not in Conflict.');
  if (state.pendingAction) return errorState(state, 'Resolve the pending action first.');

  scoreEndOfTurn(state, seat);
  if (checkWinner(state)) return state;

  const next = otherPlayer(seat);
  state.activePlayer = next;
  state.turnNumber += 1;
  state.players[seat].currentBattleplan = null;
  state.players[seat].turnFlags = freshTurnFlags();
  state.players[next].turnFlags = freshTurnFlags();
  resetTurnTemporaryEffects(state);
  prepareStrategyPhase(state, next);
  return state;
}

function concede(state, action, uid) {
  const seat = requireActor(state, uid);
  const winner = otherPlayer(seat);
  state.status = 'finished';
  state.phase = 'gameOver';
  state.winner = winner;
  state.pendingAction = null;
  addLog(state, `${state.players[seat].name} conceded. ${state.players[winner].name} wins.`);
  return state;
}

function rematch(state, action, uid) {
  const seat = requireActor(state, uid);
  state.players[seat].ready = true;
  state.status = 'lobby';
  state.phase = 'lobby';
  state.winner = null;
  state.pendingAction = null;
  addLog(state, `${state.players[seat].name} requested a rematch. Ready up in the lobby.`);
  return state;
}
