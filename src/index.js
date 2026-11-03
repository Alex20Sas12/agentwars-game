import { GameState } from './engine';

// ---- in-memory store (single worker isolate) ----
// ponytail: in-memory Map, lost on worker restart; fine for <10min matches
// games survive module re-eval by living on globalThis
const games = globalThis.__aw_games || (globalThis.__aw_games = new Map()); // matchCode -> {state, lastSeen, log}
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return games.has(s) ? newCode() : s;
}

let reaper = null; // ponytail: lazy interval, init on first request
function ensureReaper() {
  if (reaper) return;
  reaper = setInterval(() => {
    const now = Date.now();
    for (const [code, g] of games) if (now - g.lastSeen > 20 * 60 * 1000) games.delete(code);
  }, 60 * 1000);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
  });
}

async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}

export default {
  async fetch(request, env) {
    ensureReaper();
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ---- Agent HTTP/JSON API ----
    // POST /api/games                       -> create/join match (returns token+code)
    // GET  /api/games/<code>                -> full game state (public view)
    // POST /api/games/<code>/join           -> {name} join human seat
    // POST /api/games/<code>/bot            -> fill empty seats with bots
    // POST /api/games/<code>/move           -> {token, move:{action, ...}}
    // GET  /api/games/<code>/log            -> match log
    if (path.startsWith('/api/')) {
      const parts = path.split('/').filter(Boolean); // api, games, CODE, action
      const code = parts[2];
      let game = code ? games.get(code) : null;

      if (path === '/api/games' && method === 'POST') {
        const body = await readBody(request);
        const bots = Math.min(Math.max(parseInt(body.bots || 0), 0), 3);
        const code2 = newCode();
        const g = { state: GameState.newGame(), lastSeen: Date.now(), log: [] };
        g.state.addPlayer(String(body.name || 'Agent').slice(0, 20), 'agent', null);
        for (let i = 0; i < bots; i++) g.state.addPlayer('Bot ' + (i + 1), 'bot', null);
        const token = GameState.token();
        g.state.seats[0].token = token;
        games.set(code2, g);
        return json({ ok: true, matchCode: code2, token, api: '/api/games/' + code2, yourSeat: 0 });
      }

      if (parts[3] === 'join' && method === 'POST' && game) {
        const body = await readBody(request);
        const seat = game.state.joinHuman(String(body.name || 'Player').slice(0, 20));
        if (seat === null) return json({ ok: false, error: 'no free seats or already started' }, 409);
        return json({ ok: true, seat, started: game.state.started });
      }

      if (parts[3] === 'bot' && method === 'POST' && game) {
        const n = game.state.fillBots();
        return json({ ok: true, botsAdded: n, started: game.state.started });
      }

      if (parts[3] === 'move' && method === 'POST' && game) {
        const body = await readBody(request);
        const r = game.state.applyMove(body.token, body.move || {});
        game.lastSeen = Date.now();
        return json(r, r.ok ? 200 : 400);
      }

      if (parts[3] === 'log' && game) {
        return json({ ok: true, log: game.state.log });
      }

      if (code && game) {
        // GET state, or POST without action -> state
        return json({ ok: true, state: game.state.publicView() });
      }
      if (code) return json({ ok: false, error: 'match not found' }, 404);
      return json({ ok: false, error: 'unknown api path' }, 404);
    }

    // ---- UI: serve static assets, or the SPA shell ----
    return env.ASSETS.fetch(request);
  },
};

