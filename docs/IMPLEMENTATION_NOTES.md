# Implementation Notes

This prototype follows the current Commander Manual as a playable browser implementation:
- 3 lanes: Left, Center, Right
- Back Row face-down cards
- Strategy, Deployment, and Conflict phases
- Battleplan choices
- Commit vs Cautious Strike
- Parry Chain
- Ruses/Traps
- 25 Aurion win condition
- Momentum at 10 and 20 Aurion

## Prototype simplifications

Some effects that require hidden choice windows are automated in this MVP to keep the game playable:
- Random discard is automatic.
- Intel auto-takes the top card from the top 3.
- Brugo's Accord lets the opponent keep their first hand card.
- Some advanced abilities log that they are not fully implemented yet.

The code is structured so these can later become proper choice modals.
