# Deck Builder + AI Fix Notes

This build changes the game to a 30-card deck-building prototype.

## AI turn speed
- AI thinking delays were shortened so the bot should no longer look frozen.
- Bot faction now defaults to Random faction.
- AI actions log to the browser console for debugging.

## Default decks
Four balanced 30-card starter decks are generated from the card database:
- Elves: Mistwood Ambush
- Humans: Aurion Vanguard
- Orcs: Blood-Pit Assault
- Dwarves: Karak-Duun Bulwark

Each default deck uses a balanced mix of faction units, events/traps, and equipment.

## Deck Builder
- The title screen now includes a Deck Builder.
- Custom decks must contain exactly 30 cards.
- Normal cards can have up to 2 copies.
- Elite cards can have up to 1 copy.
- Custom decks are saved in this browser using localStorage.
- Saved decks appear in the AI and lobby deck selectors.

## Battle setup
At the start of any battle, each player can choose:
- faction
- deck: default faction deck or a saved custom deck

Online custom deck note: for this beginner build, custom decks are saved locally per computer/browser. If Player 2 wants to use a custom deck, it must exist on Player 2's browser too.
