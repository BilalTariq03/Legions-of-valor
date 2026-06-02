import { CONFIG } from './config.js';
import { drawCards, freshTurnFlags, freshUnitTemp } from './game-state.js';
import { clampMin, otherPlayer, shuffle, titleCaseLane } from './utils.js';

export function addLog(state, message) {
  state.log = state.log || [];
  state.log.unshift(message);
  state.log = state.log.slice(0, 80);
}

export function errorState(state, message) {
  state.error = message;
  return state;
}

export function clearError(state) {
  state.error = null;
  return state;
}

export function findSeatByUid(state, uid) {
  if (!uid) return null;
  if (state.players.p1.uid === uid) return 'p1';
  if (state.players.p2.uid === uid) return 'p2';
  return null;
}

export function playerUnitCount(player) {
  if (!player?.board?.lanes) return 0;
  return CONFIG.LANES.filter(lane => player.board.lanes[lane]?.unit).length;
}

export function allUnits(player) {
  if (!player?.board?.lanes) return [];
  return CONFIG.LANES.map(lane => ({ lane, unit: player.board.lanes[lane]?.unit })).filter(x => x.unit);
}

export function hasAbility(card, abilityName) {
  if (!card || !card.abilities) return false;
  return card.abilities.some(a => String(a).trim().toLowerCase() === String(abilityName).trim().toLowerCase());
}

export function hasAnyAbility(card, names) {
  return names.some(name => hasAbility(card, name));
}

export function friendlyHasAbility(player, abilityName) {
  return allUnits(player).some(({ unit }) => hasAbility(unit, abilityName));
}

export function laneIsLockedByEnemy(state, playerKey, lane) {
  const enemy = state.players[otherPlayer(playerKey)];
  const enemyUnit = enemy.board?.lanes?.[lane]?.unit;
  return hasAbility(enemyUnit, 'Lockdown');
}

export function effectivePlayCost(state, playerKey, card, lane = null) {
  const player = state.players[playerKey];
  let cost = card.cost || 0;

  // Loyalty: deploying after / onto the same faction lane gets -1 cost.
  if (hasAbility(card, 'Loyalty') && lane) {
    const existing = player.board.lanes[lane]?.unit;
    if (existing && existing.faction === card.faction) cost -= 1;
  }

  // Logistic Specialist reduces Human unit costs while deployed.
  if (card.type === 'unit' && card.faction === 'Humans' && friendlyHasAbility(player, 'Logistic Specialist')) {
    cost -= 1;
  }

  return clampMin(cost, 0);
}

export function faceDownCost(player) {
  const activeBackrow = CONFIG.LANES.filter(lane => player.board?.backrow?.[lane]).length;
  return 1 + activeBackrow;
}

export function countEquipment(player) {
  let total = 0;
  for (const { unit } of allUnits(player)) {
    if (unit.equipment?.weapon) total++;
    if (unit.equipment?.armor) total++;
  }
  return total;
}

export function equipmentApBonus(unit, mode) {
  let total = 0;
  const equipment = [unit.equipment?.weapon, unit.equipment?.armor].filter(Boolean);
  for (const eq of equipment) {
    if (unit.temp?.noEquipmentBuffThisTurn) continue;
    total += eq.ap || 0;
    if (mode === 'attack' && hasAbility(eq, 'Honed edge')) total += 2;
    if (mode === 'defense' && hasAbility(eq, 'Shielded')) total += 2;
  }
  return total;
}

export function calculateAP(state, ownerKey, lane, mode = 'neutral') {
  const player = state.players[ownerKey];
  const unit = player.board?.lanes?.[lane]?.unit;
  if (!unit) return 0;
  let ap = unit.ap || 0;
  ap += unit.temp?.apMod || 0;

  // Equipment bonus — may be negated by Dampen
  const eqBonus = equipmentApBonus(unit, mode);
  ap += eqBonus;
  const oppKey = otherPlayer(ownerKey);
  const oppUnit = state.players[oppKey]?.board?.lanes?.[lane]?.unit;
  if (oppUnit && (hasAbility(oppUnit, 'Dampen') || hasAbility(oppUnit.equipment?.weapon, 'Dampen') || hasAbility(oppUnit.equipment?.armor, 'Dampen'))) {
    ap -= eqBonus;
  }

  if (mode === 'attack') {
    if (hasAbility(unit, 'Challenger')) ap += 2;
    if (hasAbility(unit, 'Challenger 2')) ap += 3;
  }
  if (mode === 'defense') {
    if (hasAbility(unit, 'Shielded')) ap += 2;
  }
  if (hasAbility(unit, 'Duelist') && playerUnitCount(player) === 1) ap += 2;
  if (hasAbility(unit, 'Unity')) {
    const others = allUnits(player).filter(x => x.unit.instanceId !== unit.instanceId && x.unit.faction === unit.faction).length;
    ap += others;
  }
  if (hasAbility(unit, 'Unequality')) {
    const nonOrcs = allUnits(player).filter(x => x.unit.faction !== 'Orcs').length;
    ap += nonOrcs;
  }
  // Momentum: +2 AP per other allied same-faction unit (unit ability or equipment)
  const allEquip = [unit.equipment?.weapon, unit.equipment?.armor].filter(Boolean);
  if (hasAbility(unit, 'Momentum') || allEquip.some(eq => hasAbility(eq, 'Momentum'))) {
    const allies = allUnits(player).filter(x => x.unit.instanceId !== unit.instanceId && x.unit.faction === unit.faction).length;
    ap += allies * 2;
  }
  // Glean-Strike: +3 AP if an Intel or Secrecy card was used this turn
  if (hasAbility(unit, 'Glean-Strike') && player.turnFlags?.usedIntelOrSecrecy) ap += 3;
  // Delirium: +3 AP when the player activates it (chosen sacrifice)
  if (hasAbility(unit, 'Delirium') && unit.temp?.deliriumActive) ap += 3;
  return Math.max(0, ap);
}

export function legalAttackTargets(unit, lane, defenderLanes = null) {
  const lanes = [lane];
  if (hasAbility(unit, 'Volley')) {
    if (lane === 'left') lanes.push('center');
    if (lane === 'center') lanes.push('left', 'right');
    if (lane === 'right') lanes.push('center');
  }
  const targets = [...new Set(lanes)];
  if (!defenderLanes) return targets;
  // Halt: if defender has a Halt unit adjacent to the attacker's lane, Volley is blocked
  const attackerIdx = CONFIG.LANES.indexOf(lane);
  const haltBlocked = CONFIG.LANES.some(l => {
    const u = defenderLanes[l]?.unit;
    return u && hasAbility(u, 'Halt') && Math.abs(CONFIG.LANES.indexOf(l) - attackerIdx) === 1;
  });
  return haltBlocked ? [lane] : targets;
}

export function removeFromHand(player, instanceId) {
  const idx = player.hand.findIndex(c => c.instanceId === instanceId);
  if (idx === -1) return null;
  return player.hand.splice(idx, 1)[0];
}

export function effectiveDp(card, player) {
  let dp = card.dp || 0;
  if (hasAbility(card, 'Solidarity')) dp += playerUnitCount(player);
  return dp;
}

export function randomDiscard(player) {
  if (!(player.hand || []).length) return null;
  const idx = Math.floor(Math.random() * player.hand.length);
  const [card] = player.hand.splice(idx, 1);
  player.discard.push(card);
  // Resilience: draw 1 for each card discarded from hand while unit is deployed
  if (friendlyHasAbility(player, 'Resilience')) drawCards(player, 1);
  return card;
}

export function discardCard(player, card) {
  if (!card) return;
  player.discard.push(card);
}

export function killUnit(state, ownerKey, lane, reason = 'destroyed', killerKey = null, battle = false) {
  const player = state.players[ownerKey];
  const unit = player.board.lanes[lane].unit;
  if (!unit) return null;

  // Plated equipment can prevent destruction once.
  const platedSlot = unit.equipment?.armor && hasAbility(unit.equipment.armor, 'Plated') ? 'armor'
    : unit.equipment?.weapon && hasAbility(unit.equipment.weapon, 'Plated') ? 'weapon' : null;
  if (platedSlot) {
    const plated = unit.equipment[platedSlot];
    unit.equipment[platedSlot] = null;
    player.discard.push(plated);
    addLog(state, `${unit.name}'s Plated equipment prevented destruction.`);
    return null;
  }

  player.board.lanes[lane].unit = null;
  player.turnFlags.lostUnitThisTurn = true;

  if (hasAbility(unit, 'Soul-Tribute')) {
    player.tribute.push(unit);
    addLog(state, `${unit.name} moved to Permanent Tribute.`);
  } else {
    player.discard.push(unit);
  }

  if (hasAbility(unit, 'Curse')) {
    const discarded = randomDiscard(player);
    if (discarded) addLog(state, `${unit.name}'s Curse forced ${player.name} to discard ${discarded.name}.`);
  }
  if (hasAbility(unit, 'Despair')) {
    player.aurion = clampMin(player.aurion - 1, 0);
    addLog(state, `${unit.name}'s Despair cost ${player.name} 1 Aurion.`);
  }
  if (battle && hasAbility(unit, 'Martyrdom')) {
    player.aurion += 1;
    addLog(state, `${unit.name}'s Martyrdom gave ${player.name} +1 Aurion.`);
  }
  if (hasAbility(unit, 'Hard Bargain')) {
    player.aurion = clampMin(player.aurion - 2, 0);
    addLog(state, `${unit.name}'s Hard Bargain cost ${player.name} 2 Aurion.`);
  }

  // Equipment attached to destroyed units goes to discard too.
  for (const eq of [unit.equipment?.weapon, unit.equipment?.armor].filter(Boolean)) {
    player.discard.push(eq);
  }

  return unit;
}

export function awardKillAurion(state, killerKey, killedUnit) {
  if (!killedUnit) return;
  const player = state.players[killerKey];
  player.aurion += killedUnit.elite ? 2 : 1;
  addLog(state, `${player.name} gained ${killedUnit.elite ? 2 : 1} Aurion for defeating ${killedUnit.name}.`);
}

export function triggerOnWinAbilities(state, winnerKey, winningUnit, losingPlayerKey) {
  const winner = state.players[winnerKey];
  const loser = state.players[losingPlayerKey];
  if (!winningUnit) return;
  if (hasAbility(winningUnit, 'Pierce')) {
    winner.aurion += 1;
    addLog(state, `${winningUnit.name}'s Pierce gained +1 Aurion.`);
  }
  if (hasAbility(winningUnit, 'Cleave')) {
    const discarded = randomDiscard(loser);
    if (discarded) addLog(state, `${winningUnit.name}'s Cleave discarded ${discarded.name}.`);
  }
  if (hasAbility(winningUnit, 'Raging cry')) {
    const discarded = randomDiscard(loser);
    if (discarded) addLog(state, `${winningUnit.name}'s Raging Cry discarded ${discarded.name}.`);
  }
  if (hasAbility(winningUnit, 'Hard Bargain')) {
    winner.aurion += 2;
    addLog(state, `${winningUnit.name}'s Hard Bargain gained +2 Aurion.`);
  }
  if (hasAbility(winningUnit, 'Endless Stream')) {
    drawCards(winner, 1);
    addLog(state, `${winningUnit.name}'s Endless Stream drew a card.`);
  }
  if (hasAbility(winningUnit, 'Bloodthirst') && !winningUnit.temp.bloodthirstUsed) {
    winningUnit.temp.hasAttacked = false;
    winningUnit.temp.bloodthirstUsed = true;
    addLog(state, `${winningUnit.name}'s Bloodthirst allows another attack.`);
  }
}

export function triggerMonarchStrike(state, attackerKey, attackerUnit) {
  const attacker = state.players[attackerKey];
  const defender = state.players[otherPlayer(attackerKey)];
  if (CONFIG.MONARCH_STRIKE_AURION_REWARD > 0) {
    attacker.aurion += CONFIG.MONARCH_STRIKE_AURION_REWARD;
  }
  if (hasAbility(attackerUnit, 'Shatter')) {
    const discarded = randomDiscard(defender);
    if (discarded) addLog(state, `${attackerUnit.name}'s Shatter discarded ${discarded.name}.`);
  }
  if (hasAbility(attackerUnit, 'Siphon') && defender.aurion > 0) {
    defender.aurion -= 1;
    attacker.aurion += 1;
    addLog(state, `${attackerUnit.name}'s Siphon stole 1 Aurion.`);
  }
}

export function onDeployAbilities(state, playerKey, lane, unit) {
  const player = state.players[playerKey];
  const opponent = state.players[otherPlayer(playerKey)];

  if (laneIsLockedByEnemy(state, playerKey, lane)) {
    addLog(state, `${unit.name}'s on-deploy ability was stopped by Lockdown.`);
    return;
  }

  if (hasAbility(unit, 'Intel')) {
    const top = (player.deck || []).splice(0, 3);
    if (top.length) {
      player.hand.push(top[0]);
      player.deck.push(...top.slice(1));
      player.turnFlags.usedIntelOrSecrecy = true;
      addLog(state, `${unit.name}'s Intel took 1 card from the top 3.`);
    }
  }
  if (hasAbility(unit, 'Excavate')) {
    const card = player.discard.pop();
    if (card) {
      player.hand.push(card);
      addLog(state, `${unit.name}'s Excavate returned ${card.name}.`);
    }
  }
  if (hasAbility(unit, 'Excavate 2')) {
    for (let i = 0; i < 2; i++) {
      const card = player.discard.pop();
      if (card) player.hand.push(card);
    }
    addLog(state, `${unit.name}'s Excavate 2 recovered cards from discard.`);
  }
  if (hasAbility(unit, 'Scorch')) {
    removeFirstEnemyEquipment(state, playerKey);
    addLog(state, `${unit.name}'s Scorch removed enemy equipment if possible.`);
  }
  if (hasAbility(unit, 'Wrath')) {
    for (const pKey of ['p1', 'p2']) {
      const p = state.players[pKey];
      for (const { unit: u } of allUnits(p)) {
        for (const slot of ['weapon','armor']) {
          if (u.equipment?.[slot]) {
            p.discard.push(u.equipment[slot]);
            u.equipment[slot] = null;
          }
        }
      }
    }
    addLog(state, `${unit.name}'s Wrath destroyed all equipment in play.`);
  }
  if (hasAbility(unit, 'Wrath of Aurion')) {
    const idx = player.deck.findIndex(c => c.type === 'equipment');
    if (idx !== -1) {
      const [eq] = player.deck.splice(idx, 1);
      const slot = eq.equipmentSlot || 'weapon';
      if (!unit.equipment[slot]) unit.equipment[slot] = eq;
      else player.hand.push(eq);
      player.deck = shuffle(player.deck);
      addLog(state, `${unit.name}'s Wrath of Aurion equipped ${eq.name}.`);
    }
  }
  if (hasAbility(unit, 'Secrecy')) {
    player.turnFlags.usedIntelOrSecrecy = true;
    const handCopy = [...(opponent.hand || [])].sort(() => Math.random() - 0.5);
    const revealed = handCopy.slice(0, Math.min(2, handCopy.length));
    if (revealed.length > 0) {
      addLog(state, `${unit.name}'s Secrecy revealed: ${revealed.map(c => c.name).join(', ')}.`);
    } else {
      addLog(state, `${unit.name}'s Secrecy: opponent hand is empty.`);
    }
  }
  if (hasAbility(unit, 'Seer')) {
    const top = (opponent.deck || []).splice(0, Math.min(2, (opponent.deck || []).length));
    if (top.length === 2) {
      opponent.discard.push(top[0]);
      opponent.deck.unshift(top[1]);
      addLog(state, `${unit.name}'s Seer discarded ${top[0].name} and kept ${top[1].name} on top of opponent's deck.`);
    } else if (top.length === 1) {
      opponent.discard.push(top[0]);
      addLog(state, `${unit.name}'s Seer discarded ${top[0].name} from opponent's deck.`);
    }
  }
  if (hasAbility(unit, 'Shockwave')) {
    removeFirstEnemyEquipment(state, playerKey);
    addLog(state, `${unit.name}'s Shockwave removed enemy equipment if possible.`);
  }
  if (hasAbility(unit, 'Terrorize')) {
    const discarded = randomDiscard(opponent);
    if (discarded) addLog(state, `${unit.name}'s Terrorize discarded ${discarded.name}.`);
  }
}

export function removeFirstEnemyEquipment(state, playerKey) {
  const opponent = state.players[otherPlayer(playerKey)];
  for (const lane of CONFIG.LANES) {
    const unit = opponent.board.lanes[lane].unit;
    if (!unit) continue;
    for (const slot of ['weapon', 'armor']) {
      if (unit.equipment?.[slot]) {
        opponent.discard.push(unit.equipment[slot]);
        unit.equipment[slot] = null;
        return true;
      }
    }
  }
  return false;
}

export function applyEventEffect(state, playerKey, card, targetLane = null) {
  const player = state.players[playerKey];
  const opponentKey = otherPlayer(playerKey);
  const opponent = state.players[opponentKey];
  const name = card.name.toLowerCase();

  if (hasAbility(card, 'Profit') || name.includes('supply convoy')) {
    drawCards(player, 2);
    addLog(state, `${card.name}: ${player.name} drew 2 cards.`);
    return true;
  }
  if (name.includes('wildfires') || hasAbility(card, 'Scorch')) {
    removeFirstEnemyEquipment(state, playerKey);
    addLog(state, `${card.name}: removed enemy equipment if possible.`);
    return true;
  }
  if (name.includes('cursed mists') || hasAbility(card, 'Cursed Mist') || hasAbility(card, 'Cursed mist')) {
    const discarded = randomDiscard(opponent);
    opponent.aurion = clampMin(opponent.aurion - 1, 0);
    addLog(state, `${card.name}: opponent discarded ${discarded?.name || 'nothing'} and lost 1 Aurion.`);
    return true;
  }
  if (name.includes('rain of volleys') || hasAbility(card, 'Handicap')) {
    for (const { unit } of allUnits(opponent)) {
      if (!hasAbility(unit, 'Aegis')) unit.temp.apMod -= 1;
    }
    addLog(state, `${card.name}: enemy units without Aegis get -1 AP this turn.`);
    return true;
  }
  if (name.includes('transmute') || hasAbility(card, 'Transmute')) {
    if (player.hand.length < 2) return false;
    const a = player.hand.shift();
    const b = player.hand.shift();
    player.discard.push(a, b);
    drawCards(player, 3);
    addLog(state, `${card.name}: discarded 2 cards and drew 3.`);
    return true;
  }
  if (name.includes('overrun') || hasAbility(card, 'Overrun')) {
    for (const { unit } of allUnits(player)) unit.temp.apMod += 2;
    addLog(state, `${card.name}: all friendly units gain +2 AP this turn.`);
    return true;
  }
  if (name.includes('chain down') || hasAbility(card, 'Chain down') || hasAbility(card, 'Chain Down')) {
    const unit = opponent.board?.lanes?.[targetLane || 'center']?.unit;
    if (unit && hasAbility(unit, 'Aegis')) {
      addLog(state, `${unit.name}'s Aegis blocked Chain Down.`);
      return true;
    }
    if (unit) {
      unit.temp.cannotAttack = true;
      unit.temp.cannotUseAbility = true;
    }
    addLog(state, `${card.name}: chained a unit if present.`);
    return true;
  }
  if (name.includes('fog of war') || hasAbility(card, 'Fog of war') || hasAbility(card, 'Fog of War')) {
    state.noParryUntilTurnEnd = true;
    addLog(state, `${card.name}: no player can Parry this turn.`);
    return true;
  }
  if (name.includes('harvest') || hasAbility(card, 'harvest') || hasAbility(card, 'Harvest')) {
    for (let i = 0; i < 2; i++) {
      if (player.deck.length) player.tribute.push(player.deck.shift());
    }
    addLog(state, `${card.name}: moved top 2 deck cards to tribute.`);
    return true;
  }
  if (name.includes('calamity') || hasAbility(card, 'Calamity')) {
    const lane = targetLane || 'center';
    for (const pKey of ['p1', 'p2']) {
      const u = state.players[pKey]?.board?.lanes?.[lane]?.unit;
      if (u && hasAbility(u, 'Aegis')) {
        addLog(state, `${u.name}'s Aegis survived Calamity.`);
      } else {
        killUnit(state, pKey, lane, 'calamity');
      }
    }
    addLog(state, `${card.name}: Calamity struck ${titleCaseLane(lane)}.`);
    return true;
  }
  if (name.includes('order of the elven empire') || hasAbility(card, 'Banishment')) {
    for (const pKey of ['p1', 'p2']) {
      const p = state.players[pKey];
      for (const lane of CONFIG.LANES) {
        const unit = p.board.lanes[lane].unit;
        if (unit && unit.cost < 5 && !hasAbility(unit, 'Aegis')) {
          p.board.lanes[lane].unit = null;
          p.hand.push(unit);
        }
      }
    }
    addLog(state, `${card.name}: returned all units costing less than 5 to hand.`);
    return true;
  }
  if (name.includes("brugo's accord") || hasAbility(card, "Brugo's Accord") || hasAbility(card, "Brugo's accord")) {
    if (opponent.hand.length > 1) {
      const keep = opponent.hand[0];
      opponent.discard.push(...opponent.hand.slice(1));
      opponent.hand = [keep];
    }
    addLog(state, `${card.name}: opponent kept 1 card and discarded the rest.`);
    return true;
  }
  if (name.includes('contract of the') || hasAbility(card, 'Assasinate')) {
    const lane = targetLane || 'center';
    const assassinTarget = opponent.board?.lanes?.[lane]?.unit;
    if (assassinTarget && hasAbility(assassinTarget, 'Aegis')) {
      addLog(state, `${assassinTarget.name}'s Aegis blocked the assassination.`);
      return true;
    }
    const killed = killUnit(state, opponentKey, lane, 'assassinated', playerKey);
    if (killed) addLog(state, `${card.name}: destroyed ${killed.name}.`);
    return true;
  }
  if (name.includes('plight of rykard') || hasAbility(card, "Rykard's plight")) {
    for (let i = 0; i < 2; i++) {
      const idx = player.deck.findIndex(c => c.type === 'equipment');
      if (idx === -1) break;
      const [eq] = player.deck.splice(idx, 1);
      const target = allUnits(player).find(({ unit }) => !unit.equipment?.[eq.equipmentSlot || 'weapon']);
      if (target) target.unit.equipment[eq.equipmentSlot || 'weapon'] = eq;
      else player.hand.push(eq);
    }
    player.deck = shuffle(player.deck);
    addLog(state, `${card.name}: searched for 2 equipment cards.`);
    return true;
  }
  if (name.includes('battle siren') || hasAbility(card, 'Tithe')) {
    drawCards(player, 1);
    opponent.mana = clampMin(opponent.mana - 2, 0);
    addLog(state, `${card.name}: drew 1 and reduced enemy Mana by 2.`);
    return true;
  }
  if (name.includes('mind-fog') || hasAbility(card, 'Lockdown')) {
    for (const { unit } of allUnits(opponent)) unit.temp.cannotUseAbility = true;
    addLog(state, `${card.name}: enemy active abilities are disabled this turn.`);
    return true;
  }

  addLog(state, `${card.name} resolved as a prototype card. No special effect implemented yet.`);
  return true;
}

export function checkBattleplanObjective(state, playerKey) {
  const player = state.players[playerKey];
  const bp = player.currentBattleplan;
  if (!bp) return false;
  const id = bp.id;
  if (id === 'vanguards_push') return countEquipment(player) >= 2;
  if (id === 'the_iron_shield') return !!player.turnFlags.usedParryChainTwoPlusToWin;
  if (id === 'cunning_ambush') return !!player.turnFlags.triggeredTrap;
  if (id === 'wide_frontage') {
    return sideLaneControlled(state, playerKey, 'left') && sideLaneControlled(state, playerKey, 'right');
  }
  if (id === 'master_scout') return !!player.turnFlags.revealedFaceDown;
  if (id === 'tactical_reserve') return player.mana >= 3;
  if (id === 'the_grand_ruse') return !!player.turnFlags.ruseSucceeded;
  if (id === 'high_command') return !!player.turnFlags.deployedElite;
  if (id === 'total_war') return CONFIG.LANES.every(lane => (player.turnFlags.attacksDeclaredByLane || []).includes(lane));
  if (id === 'last_stand') return !player.turnFlags.lostUnitThisTurn;
  return false;
}

export function sideLaneControlled(state, playerKey, lane) {
  const enemyKey = otherPlayer(playerKey);
  const own = calculateAP(state, playerKey, lane, 'neutral');
  const enemy = calculateAP(state, enemyKey, lane, 'neutral');
  return own > enemy;
}

export function scoreEndOfTurn(state, playerKey) {
  const player = state.players[playerKey];
  let gained = 0;
  for (const lane of ['left', 'right']) {
    if (sideLaneControlled(state, playerKey, lane)) gained += 1;
  }
  if (gained) {
    player.aurion += gained;
    addLog(state, `${player.name} gained ${gained} Aurion from side-lane control.`);
  }

  if (checkBattleplanObjective(state, playerKey)) {
    const reward = player.currentBattleplan.reward || 0;
    player.aurion += reward;
    addLog(state, `${player.name} completed ${player.currentBattleplan.name} for +${reward} Aurion.`);
    const hasSovereign = allUnits(player).some(({ unit }) =>
      hasAbility(unit, 'Sovereign') ||
      hasAbility(unit.equipment?.weapon, 'Sovereign') ||
      hasAbility(unit.equipment?.armor, 'Sovereign')
    );
    if (hasSovereign) {
      player.aurion += 1;
      addLog(state, `${player.name}'s Sovereign granted +1 bonus Aurion.`);
    }
  }
  applyMomentumThresholds(state, playerKey);
}

export function applyMomentumThresholds(state, scoringPlayerKey) {
  const player = state.players[scoringPlayerKey];
  const opponent = state.players[otherPlayer(scoringPlayerKey)];
  if (player.aurion >= 10 && !player.thresholdsTriggered.ten) {
    player.thresholdsTriggered.ten = true;
    opponent.momentumDrawBonus += 1;
    addLog(state, `${opponent.name} receives Momentum: +1 card next Strategy Phase.`);
  }
  if (player.aurion >= 20 && !player.thresholdsTriggered.twenty) {
    player.thresholdsTriggered.twenty = true;
    opponent.momentumDrawBonus += 1;
    addLog(state, `${opponent.name} receives Momentum: +1 card next Strategy Phase.`);
  }
}

export function checkWinner(state) {
  for (const key of ['p1', 'p2']) {
    if (state.players[key].aurion >= CONFIG.WIN_AURION) {
      state.status = 'finished';
      state.phase = 'gameOver';
      state.winner = key;
      state.pendingAction = null;
      addLog(state, `${state.players[key].name} wins with ${state.players[key].aurion} Aurion!`);
      return key;
    }
  }
  return null;
}

export function prepareStrategyPhase(state, playerKey) {
  const player = state.players[playerKey];
  if (player.battleplanDeck.length < 3) {
    // Reshuffle the standard choices by putting already-used current plan back.
    player.battleplanDeck = shuffle([...(player.battleplanDeck || []), player.currentBattleplan].filter(Boolean));
  }
  player.battleplanChoices = player.battleplanDeck.splice(0, 3);
  state.pendingAction = { type: 'chooseBattleplan', player: playerKey };
  state.phase = 'strategy';
  addLog(state, `${player.name} is choosing a Battleplan.`);
}

export function resetTurnTemporaryEffects(state) {
  state.noParryUntilTurnEnd = false;
  for (const key of ['p1', 'p2']) {
    for (const { unit } of allUnits(state.players[key])) {
      unit.temp = freshUnitTemp();
    }
  }
}
