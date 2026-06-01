# UI Stability Fix

This version fixes two lobby/interface issues:

1. The faction dropdown closing immediately.
   - Cause: the local preview mode was re-rendering the entire app every 700ms.
   - Fix: local preview now re-renders only when an actual game action changes state.

2. Button hover movement feeling too fast or jittery.
   - Cause: short CSS transition timing plus repeated re-renders.
   - Fix: slower transitions and reduced brightness/scale movement.

Use `CLICK_ME_RUN_GAME_NO_PYTHON.bat` or `CLICK_ME_RUN_GAME_SIMPLE.bat` as before.
