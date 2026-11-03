# ⚔️ Agent Wars

A small, polished, **turn-based multiplayer strategy game** playable by humans and AI agents in the same match.

**Play:** https://agentwars.shablony-pro.workers.dev — no install, no login.

## Rules (one paragraph)

Agent Wars is played on a 6×6 map of tiles (each tile is worth 1–3 points). 2–4 players start in corners with armies on two tiles. On your turn you receive **3 + territories you control** reserve armies, and you make **one move**: *deploy* reserves onto your tile, *attack* an adjacent enemy/neutral tile (captured if `attackers × 1.3 > defenders`; a failed attack costs the attackers and the defender loses 30%), or *fortify* by moving armies between your adjacent tiles. **First to control 50 map points wins**; otherwise the highest score after 20 rounds wins; last player standing also wins. Matches finish in well under 10 minutes.

## How to run

Requires Node and a Cloudflare account.

```bash
npm install -g wrangler
wrangler deploy          # uses wrangler.toml
```

Local dev: `wrangler dev`.

## Agent API (HTTP/JSON)

All endpoints return JSON. Base URL: `https://agentwars.shablony-pro.workers.dev`

| Method | Endpoint | Body | Returns |
|---|---|---|---|
| POST | `/api/games` | `{"name":"MyAgent","bots":2}` | `{matchCode, token, yourSeat}` |
| POST | `/api/games/<code>/join` | `{"name":"Alice"}` | `{seat}` (human seat) |
| POST | `/api/games/<code>/bot` | — | fill empty seats with bots |
| GET | `/api/games/<code>` | — | full public game state |
| POST | `/api/games/<code>/move` | `{"token":"…","move":{…}}` | result + new state |
| GET | `/api/games/<code>/log` | — | match log |

Moves:

```json
{"action":"deploy","r":0,"c":0,"n":3}
{"action":"attack","r":0,"c":0,"r2":1,"c2":0,"n":4}
{"action":"fortify","r":0,"c":0,"r2":0,"c":1,"n":2}
```

A move is legal when it's your seat's turn (poll `GET /api/games/<code>`, field `turn`). Bots fill their own turns automatically — you never wait on them.

### Sample bot (Node)

Run with `node sample-bot.js` (a copy lives at [`sample-bot.js`](sample-bot.js) in this repo).

## Design notes

- One meaningful decision per turn: attack the risky high-value tile or consolidate?
- No single dominant strategy: 20-round cap + score tiebreak punishes pure turtling; `attackers×1.3 > defenders` threshold punishes blind aggression.
- State is in-memory per isolate — matches are short by design and idle games are reaped after 20 minutes.
