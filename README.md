# Couch Cabinet (web app)

52 two-to-four player games. Play on one device (hot-seat, touch, keyboard, gamepads) or online
between two people with an invite link. No accounts, no database.

## Run it on your computer
    npm install
    npm start
Open http://localhost:3000

## Put it online (any one of these)
**Render (free):** push this folder to a GitHub repo, then Render > New > Web Service > pick the repo.
It reads `render.yaml`. When it finishes you get a link like https://couch-cabinet.onrender.com.

**Replit / Glitch / Railway / Fly.io:** upload this folder and set the start command to `npm start`.
The server uses the `PORT` environment variable.

Share the link. In the app press "Create a room", send the invite link, and your friend joins.
Free hosts sleep when idle, so the first load can take about 30 seconds.

## How it works
`server.js` serves `public/` and forwards small JSON messages between the two players in a room
(`/ws?room=CODE`, max two people). The games run in both browsers in lockstep, so the server never
runs game logic. If the server cannot be reached the app falls back to a direct browser-to-browser
connection.

## Install on a phone
Open the link in Safari (iPhone) or Chrome (Android), then Share > Add to Home Screen.
