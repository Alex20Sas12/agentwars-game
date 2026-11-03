// sample-bot.js — a greedy Agent Wars bot (no deps, Node 18+)
const BASE = 'https://agentwars.shablony-pro.workers.dev';

async function get(p) { return (await fetch(BASE + p)).json(); }
async function post(p, body) { return (await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json(); }

async function main() {
  const create = await post('/api/games', { name: 'GreedyBot', bots: 3 });
  const { matchCode, token } = create;
  console.log('match', matchCode);

  for (;;) {
    const { state } = await get('/api/games/' + matchCode);
    if (state.winner !== null) { console.log('winner seat', state.winner, 'score', state.seats[state.winner].score); break; }
    const me = state.seats.find(s => s.name === 'GreedyBot');
    if (state.turn === me.id) {
      const mine = state.map.filter(t => t.owner === me.id);
      // 1) deploy all reserves on the strongest tile
      const from = mine.slice().sort((a, b) => b.armies - a.armies)[0];
      if (me.reserves > 0) {
        await post('/api/games/' + matchCode + '/move', { token, move: { action: 'deploy', r: from.r, c: from.c, n: me.reserves } });
      }
      // 2) attack weakest adjacent enemy tile
      const target = state.map.find(t =>
        t.owner !== me.id && Math.abs(t.r - from.r) + Math.abs(t.c - from.c) === 1 &&
        (from.armies - 1) * 1.3 > t.armies);
      if (target) {
        const r = await post('/api/games/' + matchCode + '/move', { token, move: { action: 'attack', r: from.r, c: from.c, r2: target.r, c2: target.c, n: from.armies - 1 } });
        if (!r.ok) console.log('move rejected:', r.error);
      }
    } else {
      await new Promise(r => setTimeout(r, 700));
    }
  }
}
main();
