import { CONFIG } from '../core/config.js';
import { FACTIONS } from '../data/cards.js';
import { getDecksForFaction, getDefaultDecks, DECK_SIZE } from '../data/decks.js';
import { abilityText } from '../data/abilities.js';
import { otherPlayer, titleCaseLane } from '../core/utils.js';
import { calculateAP, faceDownCost, legalAttackTargets, countEquipment, effectiveDp, tributeAvailable } from '../core/rules.js';


function renderDeckOptionsForFaction(faction, selectedId = '') {
  const decks = getDecksForFaction(faction);
  return decks.map(deck => `<option value="${escapeAttr(deck.id)}" ${deck.id === selectedId ? 'selected' : ''}>${escapeHtml(deck.name)} ${deck.isDefault ? '(Default)' : '(Custom)'}</option>`).join('');
}

function renderAllDeckOptions() {
  return getDefaultDecks().map(deck => `<option value="${escapeAttr(deck.id)}">${escapeHtml(deck.faction)} — ${escapeHtml(deck.name)}</option>`).join('');
}

export function renderTitle({ configured, roomFromUrl }) {
  return `
    <main class="title-screen">
      <section class="title-card">
        <h1 class="logo">Legions of Valor</h1>
        <p class="subtitle">Online 1v1 medieval fantasy lane-card prototype. Create a room, share the code/link, and duel for 25 Aurion.</p>
        <div class="title-actions">
          <div class="action-box">
            <h2>Create Duel</h2>
            <div class="stack">
              <input id="playerName" placeholder="Your commander name" maxlength="24" />
              <button data-action="create-room">Create Room</button>
            </div>
          </div>
          <div class="action-box">
            <h2>Join Duel</h2>
            <div class="stack">
              <input id="joinName" placeholder="Your commander name" maxlength="24" />
              <input id="roomCode" class="join-link-input" placeholder="Room code or full invite link" value="${roomFromUrl || ''}" />
              <button data-action="join-room">Join Room</button>
            </div>
          </div>
          <div class="action-box">
            <h2>Play vs AI</h2>
            <div class="stack">
              <input id="aiName" placeholder="Your commander name" maxlength="24" />
              <label class="small-note">Your faction</label>
              <select id="aiPlayerFaction" data-action="refresh-title-decks">
                ${FACTIONS.map(f => `<option value="${f}" ${f === 'Humans' ? 'selected' : ''}>${f}</option>`).join('')}
              </select>
              <label class="small-note">Your deck</label>
              <select id="aiPlayerDeck" data-deck-select-for="aiPlayerFaction">
                ${renderDeckOptionsForFaction('Humans')}
              </select>
              <label class="small-note">Bot faction</label>
              <select id="aiBotFaction" data-action="refresh-title-decks">
                <option value="random" selected>Random faction</option>
                ${FACTIONS.map(f => `<option value="${f}">${f}</option>`).join('')}
              </select>
              <label class="small-note">Bot deck</label>
              <select id="aiBotDeck" data-deck-select-for="aiBotFaction">
                <option value="auto" selected>Auto: default deck for bot faction</option>
                ${renderAllDeckOptions()}
              </select>
              <label class="small-note">Difficulty</label>
              <select id="aiDifficulty">
                <option value="easy">Easy - Training</option>
                <option value="normal" selected>Normal - Captain</option>
                <option value="hard">Hard - Warlord</option>
              </select>
              <button data-action="create-ai-room">Start AI Duel</button>
            </div>
          </div>
          <div class="action-box deck-builder-box">
            <h2>Deck Builder</h2>
            <p class="small-note">Build and save custom ${DECK_SIZE}-card decks combining up to 2 races. Saved decks appear in the deck selectors.</p>
            <div class="stack">
              <input id="builderDeckName" placeholder="Deck name" maxlength="32" />
              <label class="small-note">Primary faction</label>
              <select id="builderFaction" data-action="builder-refresh">${FACTIONS.map(f => `<option value="${f}">${f}</option>`).join('')}</select>
              <label class="small-note">Secondary faction (optional)</label>
              <select id="builderFaction2" data-action="builder-refresh2">
                <option value="">None (single-race deck)</option>
                ${FACTIONS.map(f => `<option value="${f}">${f}</option>`).join('')}
              </select>
              <div id="builderCount" class="small-note">0 / ${DECK_SIZE} cards</div>
              <div class="action-grid compact"><button data-action="builder-save">Save Custom Deck</button><button data-action="builder-clear">Clear</button></div>
              <div id="builderSelected" class="builder-list"></div>
              <div id="builderCards" class="builder-card-pool"></div>
              <h3>Saved Custom Decks</h3>
              <div id="savedDecks" class="builder-list"></div>
            </div>
          </div>
          <div class="action-box">
            <h2>How It Plays</h2>
            <p class="small-note">Three lanes. Choose a Battleplan. Deploy units, equipment, and face-down Ruses/Traps. Commit for full force or use Cautious Strike to disarm hidden cards. Parry by discarding cards for DP. First to 25 Aurion wins.</p>
          </div>
        </div>
        ${configured ? '' : `<div class="warning"><b>Firebase not configured yet.</b><br/>The project will open locally, but online rooms will not work until you paste your Firebase config in <code>/src/config/firebase-config.js</code>.</div>`}
      </section>
    </main>`;
}

export function renderLobby(room, uid, inviteUrl = "") {
  const state = room.gameState;
  const mySeat = seatByUid(state, uid);
  const bothSeatsFilled = !!(state.players.p1.uid && state.players.p2.uid);
  const bothFactionsChosen = !!(state.players.p1.faction && state.players.p2.faction);
  const canStartDuel = !!(mySeat && bothSeatsFilled && bothFactionsChosen);
  return `
    <main class="lobby-wrap">
      <section class="lobby-card">
        <h1 class="panel-title">War Room</h1>
        <p>Room Code: <span class="room-code">${state.roomCode}</span></p>
        <div class="invite-box">
          <label class="small-note">Invite link for Player 2</label>
          <div class="invite-row">
            <input id="inviteLinkText" class="invite-link-input" readonly value="${escapeHtml(inviteUrl)}" data-action="select-invite-link" />
            <button type="button" data-action="copy-link">Copy Invite Link</button>
          </div>
          <p class="small-note">Player 2 may paste either the full invite link or only the room code into the Join Duel box.</p>
        </div>
        <div class="action-grid compact">
          <button data-action="return-title">Return to Title</button>
        </div>
        <div class="lobby-grid" style="margin-top:16px;">
          ${renderSeat(state, 'p1', uid, mySeat)}
          ${renderSeat(state, 'p2', uid, mySeat)}
        </div>
        <div class="warning" style="margin-top:16px;">When both players choose a faction and ready up, the game starts automatically.</div>
        <div class="action-box" style="margin-top:12px;">
          <div class="small-note"><b>Backup start button:</b> If both players have joined and chosen factions but Ready does not auto-start, click this.</div>
          <button style="margin-top:10px; width:100%;" data-action="force-start-game" ${canStartDuel ? '' : 'disabled'}>Start Duel Now</button>
        </div>
        ${state.error ? `<div class="error-toast">${escapeHtml(state.error)}</div>` : ''}
      </section>
    </main>
  `;
}

function renderSeat(state, seat, uid, mySeat = null) {
  const p = state.players[seat];
  const isMine = mySeat === seat || (!mySeat && p.uid === uid);
  const isBot = !!p.isBot;
  const empty = !p.uid;
  return `<div class="seat">
    <h2 class="panel-title">${seat.toUpperCase()} ${isMine ? '<span class="badge">You</span>' : ''}${isBot ? '<span class="badge">AI</span>' : ''}</h2>
    <p><b>${empty ? 'Empty Seat' : escapeHtml(p.name)}</b></p>
    ${isBot ? `<p class="small-note">Difficulty: ${escapeHtml(p.aiDifficulty || 'normal')}</p>` : ''}
    ${empty ? `<button data-action="claim-seat" data-seat="${seat}">Claim Seat</button>` : ''}
    ${isMine ? `
      <label class="small-note">Faction</label>
      <select data-action="select-faction">
        <option value="">Choose faction...</option>
        ${FACTIONS.map(f => `<option value="${f}" ${p.faction === f ? 'selected' : ''}>${f}</option>`).join('')}
      </select>
      ${p.faction ? `<label class="small-note">Deck</label><select data-action="select-deck">${renderDeckOptionsForFaction(p.faction, p.deckChoiceId)}</select>` : `<p class="small-note">Choose a faction to unlock decks.</p>`}
      <button type="button" style="margin-top:10px;" data-action="ready-player" data-seat="${seat}" data-ready="${!p.ready}">${p.ready ? 'Unready' : 'Ready'}</button>
    ` : `<p>Faction: ${p.faction || 'Not chosen'}</p>`}
    <p>Status: ${p.ready ? 'Ready' : 'Not ready'}</p>
  </div>`;
}

export function renderGame(room, uid, uiState) {
  const state = room.gameState;
  const mySeat = seatByUid(state, uid) || 'p1';
  const enemySeat = otherPlayer(mySeat);
  const me = state.players[mySeat];
  const enemy = state.players[enemySeat];
  const isMyTurn = state.activePlayer === mySeat;
  const selectedCard = findInHand(me, uiState.selectedCardId);
  const selectedUnit = uiState.selectedUnitLane ? me.board.lanes[uiState.selectedUnitLane]?.unit : null;

  if (state.phase === 'gameOver') return renderGameOver(state, mySeat);

  return `
    <main class="layout">
      <aside class="side-panel">
        <h2 class="panel-title">Command</h2>
        <div class="phase-pill">${state.phase.toUpperCase()} · Turn ${state.turnNumber}</div>
        <div class="turn-banner ${isMyTurn ? '' : 'waiting'}">${isMyTurn ? 'Your turn.' : (state.players[state.activePlayer]?.isBot ? `AI thinking: ${escapeHtml(state.players[state.activePlayer].name)}...` : `Waiting for ${escapeHtml(state.players[state.activePlayer].name)}...`)}</div>
        ${renderStats(me, enemy)}
        ${renderTributePile(me, isMyTurn, state.phase)}
        ${renderBattleplan(me)}
        ${renderSelectionActions(state, mySeat, selectedCard, selectedUnit, uiState)}
        <div class="debug-panel">
          <b>Debug</b>
          <pre>seat: ${mySeat}\nactive: ${state.activePlayer}\npending: ${state.pendingAction?.type || 'none'}\nselected card: ${uiState.selectedCardId || 'none'}\nselected unit: ${uiState.selectedUnitLane || 'none'}</pre>
        </div>
      </aside>

      <section class="battlefield">
        ${renderPlayerStrip(enemy, true)}
        ${renderBackrow(state, enemySeat, true)}
        <div class="center-warzone">
          ${renderLaneRow(state, enemySeat, true, uiState)}
          <div class="lane-label-row"><span>Left Lane</span><span>Center Lane</span><span>Right Lane</span></div>
          ${renderLaneRow(state, mySeat, false, uiState)}
        </div>
        ${renderBackrow(state, mySeat, false)}
        <div class="hand-zone"><div class="hand-scroll">${me.hand.map(card => renderCard(card, { hand: true, selected: uiState.selectedCardId === card.instanceId })).join('') || '<span class="empty-slot">No cards in hand</span>'}</div></div>
      </section>

      <aside class="right-panel">
        <h2 class="panel-title">Battle Log</h2>
        <div class="action-grid compact">
          <button data-action="end-deployment" ${!(isMyTurn && state.phase === 'deployment') ? 'disabled' : ''}>End Deployment</button>
          <button data-action="end-conflict" ${!(isMyTurn && state.phase === 'conflict' && !state.pendingAction) ? 'disabled' : ''}>End Conflict</button>
          <button data-action="concede">Concede</button>
          <button data-action="clear-selection">Clear Selection</button>
        </div>
        <div class="log-list" style="margin-top:12px;">${state.log.map(item => `<div class="log-item">${escapeHtml(item)}</div>`).join('')}</div>
      </aside>
      ${renderPendingModal(state, mySeat)}
      ${state.error ? `<div class="error-toast">${escapeHtml(state.error)}</div>` : ''}
    </main>`;
}

function renderStats(me, enemy) {
  const tp = tributeAvailable(me);
  const pile = (me.tribute ?? []).length;
  const volatile = me.volatileTributeBonus ?? 0;
  const tpLabel = volatile !== 0 ? `${tp} TP <span class="volatile-note">(${pile}${volatile >= 0 ? '+' : ''}${volatile})</span>` : `${tp} TP`;
  return `<div class="stat-grid" style="margin-top:12px;">
    <div class="stat"><b>${me.aurion ?? 0}</b><span>Your Aurion</span></div>
    <div class="stat"><b>${enemy.aurion ?? 0}</b><span>Enemy Aurion</span></div>
    <div class="stat"><b>${tpLabel}</b><span>Tribute</span></div>
    <div class="stat"><b>${pile}</b><span>Tribute Pile</span></div>
    <div class="stat"><b>${(me.deck ?? []).length}</b><span>Deck</span></div>
    <div class="stat"><b>${(me.discard ?? []).length}</b><span>Discard</span></div>
    <div class="stat"><b>${countEquipment(me)}</b><span>Equipment Active</span></div>
  </div>`;
}

function renderTributePile(player, isMyTurn, phase) {
  const count = (player.tribute ?? []).length;
  const volatile = player.volatileTributeBonus ?? 0;
  const total = count + volatile;
  const canDrop = isMyTurn && phase === 'deployment';
  return `<div class="tribute-zone ${canDrop ? 'tribute-droppable' : ''}"
              data-drop-action="send-to-tribute"
              data-drop-lane="tribute">
    <div class="tribute-zone-label">Tribute Pile</div>
    <div class="tribute-zone-count">
      ${count} card${count !== 1 ? 's' : ''}
      ${volatile > 0 ? `<span class="volatile-bonus">+${volatile} volatile</span>` : ''}
    </div>
    <div class="tribute-zone-total">${total} TP available</div>
    ${canDrop ? '<div class="tribute-drop-hint">↓ Drag card here to tribute</div>' : ''}
  </div>`;
}

function renderBattleplan(player) {
  const bp = player.currentBattleplan;
  if (!bp) return `<div class="action-box" style="margin-top:12px;"><b>Choosing Battleplan...</b></div>`;
  return `<div class="action-box" style="margin-top:12px;">
    <h2>${escapeHtml(bp.name)}</h2>
    <p class="small-note">Reward +${bp.reward} Aurion on success</p>
    <p>${escapeHtml(bp.tacticalObjective)}</p>
  </div>`;
}

function renderSelectionActions(state, mySeat, card, selectedUnit, uiState) {
  const isMyTurn = state.activePlayer === mySeat;
  if (!isMyTurn) return `<div class="action-box" style="margin-top:12px;">Select cards to read them. Actions unlock on your turn.</div>`;
  if (state.pendingAction) return `<div class="action-box" style="margin-top:12px;">Resolve the pending ${state.pendingAction.type} first.</div>`;

  if (card) {
    const laneButtons = CONFIG.LANES.map(l => `<button data-action="${card.type === 'unit' ? 'play-unit' : card.type === 'equipment' ? 'play-equipment' : 'play-event'}" data-card-id="${card.instanceId}" data-lane="${l}">${titleCaseLane(l)}</button>`).join('');
    const setButtons = CONFIG.LANES.map(l => `<button data-action="set-facedown" data-card-id="${card.instanceId}" data-lane="${l}">Set ${titleCaseLane(l)}</button>`).join('');
    const tributeButton = state.phase === 'deployment'
      ? `<button data-action="send-to-tribute" data-card-id="${card.instanceId}"
           style="margin-top:6px; width:100%; background:rgba(100,60,10,0.6); border-color:#8b6914;">
           ⬇ Send to Tribute Pile${card.type === 'eventTrap' ? ' (+1 perm, +2 volatile)' : ' (+1 TP permanent)'}
         </button>`
      : '';
    return `<div class="card-preview">
      <h2 class="panel-title">Selected Card</h2>
      ${renderCard(card, { preview: true })}
      ${renderAbilityBreakdown(card)}
      ${state.phase === 'deployment' ? `<div class="action-grid compact" style="margin-top:10px;">${laneButtons}${setButtons}</div>${tributeButton}` : '<p class="small-note">Cards can be played during Deployment.</p>'}
    </div>`;
  }

  if (selectedUnit) {
    const lane = uiState.selectedUnitLane;
    const targets = legalAttackTargets(selectedUnit, lane, state.players[otherPlayer(mySeat)]?.board?.lanes);
    const attackButtons = targets.flatMap(t => [
      `<button data-action="declare-attack" data-from-lane="${lane}" data-to-lane="${t}" data-style="commit">Commit ${titleCaseLane(t)}</button>`,
      `<button data-action="declare-attack" data-from-lane="${lane}" data-to-lane="${t}" data-style="cautious">Cautious ${titleCaseLane(t)}</button>`
    ]).join('');
    const abilityButtons = CONFIG.LANES.map(t => `<button data-action="activate-ability" data-lane="${lane}" data-target-lane="${t}">Ability → ${titleCaseLane(t)}</button>`).join('');
    return `<div class="card-preview">
      <h2 class="panel-title">Selected Unit</h2>
      ${renderCard(selectedUnit, { preview: true })}
      <p class="small-note">Current AP: ${calculateAP(state, mySeat, lane, 'neutral')}</p>
      ${renderAbilityBreakdown(selectedUnit)}
      ${state.phase === 'conflict' ? `<div class="action-grid compact">${attackButtons}${abilityButtons}</div>` : '<p class="small-note">Units attack during Conflict.</p>'}
    </div>`;
  }

  return `<div class="action-box" style="margin-top:12px;">Click a card in your hand or one of your units to see mouse actions.</div>`;
}

function renderPlayerStrip(player, hiddenHand = false) {
  return `<div class="player-strip">
    <div>
      <div class="player-name">${escapeHtml(player.name)}</div>
      <div class="small-note">${player.faction || 'No faction'} · Deck ${(player.deck ?? []).length} · Discard ${(player.discard ?? []).length}</div>
    </div>
    <div class="opponent-hand">${Array.from({ length: hiddenHand ? (player.hand ?? []).length : 0 }, () => '<div class="mini-back"></div>').join('')}</div>
  </div>`;
}

function renderLaneRow(state, seat, opponent, uiState) {
  return `<div class="lane-zone">${CONFIG.LANES.map(lane => {
    const unit = state.players[seat]?.board?.lanes?.[lane]?.unit ?? null;
    const ap = unit ? calculateAP(state, seat, lane, opponent ? 'defense' : 'neutral') : 0;
    const dropAttrs = !opponent ? `data-drop-lane="${lane}" data-drop-action="play-unit"` : '';
    return `<div class="lane${!opponent ? ' drop-target' : ''}" data-label="${opponent ? 'Enemy' : 'Your'} ${titleCaseLane(lane)}" ${dropAttrs}>
      ${unit ? renderCard(unit, { board: true, lane, owner: seat, selected: !opponent && uiState.selectedUnitLane === lane, ap, clickable: !opponent }) : '<span class="empty-slot">Empty lane</span>'}
    </div>`;
  }).join('')}</div>`;
}

function renderBackrow(state, seat, opponent) {
  return `<div class="backrow-zone">${CONFIG.LANES.map(lane => {
    const back = state.players[seat]?.board?.backrow?.[lane] ?? null;
    const dropAttrs = !opponent ? `data-drop-lane="${lane}" data-drop-action="set-facedown"` : '';
    return `<div class="back-slot${!opponent ? ' drop-target' : ''}" data-label="${opponent ? 'Enemy' : 'Your'} Back Row ${titleCaseLane(lane)}" ${dropAttrs}>
      ${back ? (opponent ? '<div class="face-down-card">Hidden</div>' : renderFaceDown(back)) : '<span class="empty-slot">Empty back row</span>'}
    </div>`;
  }).join('')}</div>`;
}

function renderFaceDown(back) {
  return `<div class="face-down-card"><div>${back.kind === 'trap' ? 'Trap' : 'Ruse'}</div></div>`;
}

export function renderCard(card, opts = {}) {
  const typeClass = card.type === 'eventTrap' ? 'event-card' : card.type === 'equipment' ? 'equipment-card' : 'unit-card';
  const factionClass = String(card.faction || '').toLowerCase().replace(/[^a-z]/g, '');
  const selected = opts.selected ? 'selected' : '';
  const handClass = opts.hand ? 'hand-card' : '';
  const actionAttrs = opts.hand ? `data-action="select-card" data-card-id="${card.instanceId}"` : (opts.board && opts.clickable ? `data-action="select-unit" data-lane="${opts.lane}"` : '');
  const draggableAttr = opts.hand ? `draggable="true" data-draggable-card="${card.instanceId}"` : '';
  const stats = card.type === 'unit'
    ? `<span class="gem">${card.cost} TP</span><span class="gem">${opts.ap ?? card.ap} AP</span><span class="gem">${card.dp} DP</span>`
    : `<span class="gem">${card.cost} TP</span><span class="gem">${card.dp} DP</span>`;
  const equipment = card.equipment ? `<div class="equipment-tags">${card.equipment.weapon ? `<span class="equip-tag">W</span>` : ''}${card.equipment.armor ? `<span class="equip-tag">A</span>` : ''}</div>` : '';
  return `<div class="card ${typeClass} ${factionClass} ${selected} ${handClass}" ${actionAttrs} ${draggableAttr} title="${escapeAttr(card.name)}">
    <div class="card-name">${escapeHtml(card.name)} ${card.elite ? '<span class="elite-mark">★</span>' : ''}</div>
    <div class="card-art" style="--image:url('${card.image}')">${escapeHtml(card.faction)}</div>
    <div class="card-text">${escapeHtml(abilityList(card))}</div>
    <div class="card-stats">${stats}</div>
    ${equipment}
  </div>`;
}

function renderPendingModal(state, mySeat) {
  const pending = state.pendingAction;
  if (!pending) return '';
  if (pending.type === 'chooseBattleplan' && pending.player === mySeat) {
    const choices = state.players[mySeat].battleplanChoices || [];
    return `<div class="modal-backdrop"><div class="modal-card">
      <h2 class="modal-title">Choose Your Battleplan</h2>
      <p class="small-note">This is chosen once at the start of the duel. Your Battleplan defines your opening draw and the objective that earns bonus Aurion each turn.</p>
      <div class="battleplan-grid">${choices.map(bp => `<div class="battleplan" data-action="select-battleplan" data-battleplan-id="${bp.id}">
        <h3>${escapeHtml(bp.name)}</h3><p>Draw ${bp.draw} · Max Hand ${bp.maxHand}</p><p>${escapeHtml(bp.tacticalObjective)}</p><b>Reward +${bp.reward} Aurion</b>
      </div>`).join('')}</div>
    </div></div>`;
  }
  if (pending.type === 'chooseBattleplan') {
    return `<div class="modal-backdrop"><div class="modal-card"><h2 class="modal-title">Waiting for opponent to choose their Battleplan...</h2><p class="small-note">This only happens once at the start of the duel.</p></div></div>`;
  }
  if (pending.type === 'parry' && pending.defender === mySeat) {
    const hand = state.players[mySeat].hand;
    const selected = window.__lovParrySelection || [];
    const parryPlayer = state.players[mySeat];
    const total = selected.reduce((sum, id) => {
      const c = hand.find(x => x.instanceId === id);
      return sum + (c ? effectiveDp(c, parryPlayer) : 0);
    }, 0);
    const apGap = pending.attackAP - pending.baseDefendAP;
    const gapClass = apGap > 0 ? 'danger' : 'safe';
    const gapText = apGap > 0
      ? `+${apGap} (unit will die without parry)`
      : 'Already winning — parry optional';
    return `<div class="modal-backdrop"><div class="modal-card">
      <h2 class="modal-title">&#x2694; Parry Chain</h2>
      <div class="parry-attack-info">
        <div class="parry-info-row">
          <span class="parry-label">Attacking Unit</span>
          <span class="parry-value">${escapeHtml(pending.attackingUnitName || 'Unknown')}</span>
        </div>
        <div class="parry-info-row">
          <span class="parry-label">Attacking From</span>
          <span class="parry-value">${escapeHtml(titleCaseLane(pending.fromLane))} Lane</span>
        </div>
        <div class="parry-info-row">
          <span class="parry-label">Targeting Your</span>
          <span class="parry-value highlight-lane">${escapeHtml(titleCaseLane(pending.toLane))} Lane</span>
        </div>
        <div class="parry-info-row">
          <span class="parry-label">Defending Unit</span>
          <span class="parry-value">${escapeHtml(pending.defendingUnitName || 'Unknown')}</span>
        </div>
        <div class="parry-divider"></div>
        <div class="parry-info-row">
          <span class="parry-label">Enemy Attack AP</span>
          <span class="parry-value danger">${pending.attackAP}</span>
        </div>
        <div class="parry-info-row">
          <span class="parry-label">Your Defense AP</span>
          <span class="parry-value">${pending.baseDefendAP}</span>
        </div>
        <div class="parry-info-row">
          <span class="parry-label">AP Gap to Cover</span>
          <span class="parry-value ${gapClass}">${escapeHtml(gapText)}</span>
        </div>
        <div class="parry-info-row">
          <span class="parry-label">Parry DP Selected</span>
          <span class="parry-value">${total}</span>
        </div>
      </div>
      <p class="small-note" style="margin-top:8px;">Select cards from your hand below to add their DP to your defense.</p>
      <div class="parry-hand">${hand.map(card => renderCard(card, { hand: false, selected: selected.includes(card.instanceId) }).replace('class="card', `data-action="toggle-parry-card" data-card-id="${card.instanceId}" class="card hand-card`)).join('')}</div>
      <div class="action-grid compact"><button data-action="submit-parry">Confirm Parry</button><button data-action="decline-parry">Decline Parry</button></div>
    </div></div>`;
  }
  if (pending.type === 'parry') {
    return `<div class="modal-backdrop"><div class="modal-card"><h2 class="modal-title">Waiting for opponent to Parry...</h2></div></div>`;
  }
  return '';
}

function renderGameOver(state, mySeat) {
  const winner = state.players[state.winner];
  return `<main class="title-screen"><section class="title-card">
    <h1 class="logo">${escapeHtml(winner?.name || 'A Commander')} Wins</h1>
    <p class="subtitle">Final score: ${state.players.p1.name} ${state.players.p1.aurion} Aurion · ${state.players.p2.name} ${state.players.p2.aurion} Aurion</p>
    <div class="action-grid compact"><button data-action="rematch">Return to Lobby / Rematch</button><button data-action="return-title">Title Screen</button></div>
    <div class="log-list" style="margin-top:20px;">${state.log.map(item => `<div class="log-item">${escapeHtml(item)}</div>`).join('')}</div>
  </section></main>`;
}

export function seatByUid(state, uid) {
  if (uid && state.players.p1.uid === uid) return 'p1';
  if (uid && state.players.p2.uid === uid) return 'p2';

  // Browser-side seat memory is used only for this prototype's LAN/Firebase MVP.
  // It makes the UI resilient if Firebase Anonymous Auth refreshes the temporary
  // UID or if the page is reloaded during testing. The game still stores the
  // actual seats in Firebase.
  try {
    const stored = localStorage.getItem(`lovSeat_${state.roomCode}`);
    if ((stored === 'p1' || stored === 'p2') && state.players[stored]?.uid) return stored;
  } catch (_) {}

  return null;
}

function findInHand(player, id) { return player.hand.find(c => c.instanceId === id); }
function abilityList(card) { return (card.abilities || []).join(' · ') || card.description || 'No ability'; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#039;'); }

function renderAbilityBreakdown(card) {
  const abilities = card.abilities || [];

  if (!abilities.length) {
    return `<div class="ability-breakdown">
      <p class="small-note" style="margin-top:8px;">No abilities.</p>
    </div>`;
  }

  const blocks = abilities.map(name => {
    const text = abilityText(name);
    return `<div class="ability-block">
      <span class="ability-heading">${escapeHtml(name)}</span>
      <p class="ability-desc">${escapeHtml(text)}</p>
    </div>`;
  }).join('');

  return `<div class="ability-breakdown">${blocks}</div>`;
}
