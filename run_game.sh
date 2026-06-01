#!/usr/bin/env bash
# Legions of Valor local runner for macOS/Linux.
# Online multiplayer still requires Firebase config in src/config/firebase-config.js.
cd "$(dirname "$0")"
python3 -m http.server 5173
