# Fix for "localhost refused to connect"

This means the browser opened, but the local server is not running.

Use this file instead:

```text
CLICK_ME_RUN_GAME_VISIBLE.bat
```

Keep the black command window open. If you close it, the game stops and Edge will show:

```text
localhost refused to connect
```

## Most common causes

1. The ZIP was not extracted.  
   Right-click the ZIP > Extract All > then run the BAT file from the extracted folder.

2. Python is not installed.  
   Install Python and tick **Add Python to PATH** during installation.

3. You closed the black server window.  
   Run `CLICK_ME_RUN_GAME_VISIBLE.bat` again.

4. Port 5173 is already being used.  
   Close old server windows, then run again.

## Manual method

Open Command Prompt in the game folder and run:

```bat
py -3 -m http.server 5173
```

Then open Microsoft Edge:

```text
http://localhost:5173/
```
