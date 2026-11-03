// engine.test.js — minimal self-check: run engine headless, assert invariants
import { GameState } from '../src/engine.js';
import assert from 'node:assert';

// 1) two players start the game
let g = GameState.newGame();
g.addPlayer('A', 'human', 'tokA');
assert.equal(g.started, false);
g.addPlayer('B', 'bot', null);
assert.equal(g.started, true);
assert.equal(g.turnIdx, 0);
assert.ok(g.reserves[0] > 0, 'reserves granted at turn start');

// 2) illegal move rejected
let r = g.applyMove('tokB', { action: 'attack', r: 0, c: 0, r2: 1, c: 0, n: 1 });
assert.equal(r.ok, false); // not B's turn
r = g.applyMove('tokA', { action: 'deploy', r: 5, c: 5, n: 1 });
assert.equal(r.ok, false); // not A's tile

// 3) legal deploy + attack cycle
const aTile = g.map.find(t => t.owner === 0);
r = g.applyMove('tokA', { action: 'deploy', r: aTile.r, c: aTile.c, n: g.reserves[0] });
assert.equal(r.ok, true);
// now it's B's turn (bot auto-plays in nextTurn)
assert.ok(g.turn !== null);

// 4) bots: a 4-bot game reaches an end state (bots auto-play inside
//    addPlayer/nextTurn, so it may complete during setup — that's fine)
let gg = GameState.newGame();
for (const n of ['B1', 'B2', 'B3', 'B4']) { gg.addPlayer(n, 'bot', null); if (gg.winner != null) break; }
if (gg.winner == null) {
  let turns = 0;
  while (gg.winner == null && turns < 500) {
    const s = gg.seats[gg.turnIdx];
    gg.botPlay(s.id); gg.checkWin(s.id);
    if (gg.winner == null) gg.nextTurn();
    turns++;
  }
}
assert.ok(gg.winner != null, 'bots finish a game');
assert.ok(gg.round <= gg.maxRounds + 1, 'round cap respected');
const owned = gg.map.filter(t => t.owner >= 0).length;
assert.ok(owned <= 36);
console.log('OK: engine self-check passed; winner seat', gg.winner, 'round', gg.round, 'owned tiles', owned);
