// engine.js — Agent Wars game rules (self-contained, no deps)
//
// MAP: 6x6 grid of tiles. Each tile has terrain and a value.
// PLAYERS: 2-4, each starts in a corner with 5 armies on 2 tiles.
// TURN PHASE: gain armies = 3 + territories controlled.
// ACTIONS on your turn (one "move" = list of up to 2 actions):
//   - deploy: add armies to your tile
//   - attack: move armies from your tile to adjacent tile (capture if enough)
//   - fortify: move armies between own adjacent tiles
// WIN: control tiles worth >= 50 points, or last player standing, or highest
//      score after 20 rounds.

class GameState {
  constructor() {
    this.map = [];
    this.seats = [];      // {id, name, kind, token, alive, score}
    this.round = 0;
    this.turnIdx = -1;
    this.started = false;
    this.winner = null;
    this.log = [];
    this.reserves = [];   // armies to deploy per seat
    this.maxRounds = 20;
  }

  static token() { return crypto.randomUUID(); }

  static newGame() {
    const g = new GameState();
    // 6x6 map, values 1-3, deterministic-ish variety
    const vals = [];
    for (let i = 0; i < 36; i++) vals.push(1 + (i % 3 === 0 ? 2 : (i * 7 + 3) % 3));
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 6; c++)
        g.map.push({ r, c, owner: -1, armies: 0, value: vals[r * 6 + c] });
    return g;
  }

  addPlayer(name, kind, token) {
    if (this.seats.length >= 4) return null;
    const id = this.seats.length;
    const corners = [[0, 0], [0, 5], [5, 0], [5, 5]];
    const [r, c] = corners[id];
    const t1 = this.tile(r, c), t2 = this.tile(r, c === 0 ? 1 : c - 1);
    t1.owner = id; t1.armies = 3;
    t2.owner = id; t2.armies = 2;
    this.seats.push({ id, name, kind, token, alive: true });
    this.reserves.push(0);
    if (this.seats.length >= 2) this.started = true, this.nextTurn();
    return id;
  }

  joinHuman(name) {
    if (this.started && this.seats.length >= 2) {
      const seat = this.seats.find(s => !s.alive || (s.kind === 'agent' && !s.joinedHuman));
      if (!seat) return null;
      seat.name = name; seat.kind = 'human'; seat.joinedHuman = true;
      return seat.id;
    }
    const id = this.addPlayer(name, 'human', null);
    if (id != null) { this.seats[id].token = GameState.token(); }
    return id;
  }

  fillBots() {
    let n = 0;
    while (this.seats.length < 4 && !this.winner) {
      const id = this.addPlayer('Bot ' + (this.seats.length + 1), 'bot', null);
      if (id == null) break;
      this.seats[id].token = GameState.token();
      n++;
    }
    return n;
  }

  tile(r, c) { return (r < 0 || r > 5 || c < 0 || c > 5) ? null : this.map[r * 6 + c]; }

  currentSeat() { return this.started && this.winner == null ? this.seats[this.turnIdx] : null; }

  nextTurn() {
    // skip dead players, pay reserves, bots auto-play;
    // if no seat can hold a turn (human eliminated, guard exhausted) -> decide by score
    for (let guard = 0; guard < 40; guard++) {
      this.turnIdx = (this.turnIdx + 1) % this.seats.length;
      if (this.turnIdx === 0) this.round++;
      if (this.round > this.maxRounds) return this.endByScore();
      const s = this.seats[this.turnIdx];
      if (!s.alive) continue;
      this.reserves[s.id] += 3 + this.territories(s.id);
      if (s.kind === 'bot') { this.botPlay(s.id); this.checkWin(s.id); if (this.winner != null) return; continue; }
      return;
    }
    this.endByScore();
  }

  territories(pid) { return this.map.filter(t => t.owner === pid).length; }
  score(pid) { return this.map.reduce((a, t) => a + (t.owner === pid ? t.value * t.armies : 0), 0); }

  endByScore() {
    let best = -1, bid = -1;
    for (const s of this.seats) { const sc = this.score(s.id); if (sc > best) { best = sc; bid = s.id; } }
    this.winner = bid;
    this.log.push({ round: this.round, text: 'Game over: highest score wins' });
  }

  checkWin(pid) {
    const pts = this.map.reduce((a, t) => a + (t.owner === pid ? t.value : 0), 0);
    if (pts >= 50) { this.winner = pid; this.log.push({ round: this.round, text: 'Player ' + pid + ' reached 50 points' }); }
    const alive = this.seats.filter(s => s.alive);
    if (alive.length === 1) { this.winner = alive[0].id; this.log.push({ round: this.round, text: 'Last player standing' }); }
  }

  adjacent(a, b) { return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1; }

  applyMove(token, move) {
    const seat = this.seats.find(s => s.token === token);
    if (!seat) return { ok: false, error: 'invalid token' };
    if (this.winner != null) return { ok: false, error: 'game over, winner=' + this.winner };
    if (!this.started) return { ok: false, error: 'not started (need 2+ players)' };
    if (this.seats[this.turnIdx].id !== seat.id) return { ok: false, error: 'not your turn (turn of seat ' + this.seats[this.turnIdx].id + ')' };
    const r = this.doAction(seat.id, move);
    if (r.ok) { this.checkWin(seat.id); if (this.winner == null) this.nextTurn(); }
    return r;
  }

  doAction(pid, move) {
    const a = (move.action || '').toLowerCase();
    const from = this.tile(move.r, move.c);
    const n = Math.max(1, Math.min(parseInt(move.n) || 1, 99));
    if (a === 'deploy') {
      if (!from || from.owner !== pid) return { ok: false, error: 'deploy: not your tile' };
      if (n > this.reserves[pid]) return { ok: false, error: 'deploy: not enough reserves (' + this.reserves[pid] + ')' };
      this.reserves[pid] -= n; from.armies += n;
      this.log.push({ round: this.round, seat: pid, text: 'deploy ' + n + ' at (' + from.r + ',' + from.c + ')' });
      return { ok: true, state: this.publicView() };
    }
    if (a === 'attack' || a === 'fortify') {
      if (!from) return { ok: false, error: 'bad from-tile' };
      if (from.owner !== pid) return { ok: false, error: 'from-tile not yours' };
      const to = this.tile(move.r2, move.c2);
      if (!to || !this.adjacent(from, to)) return { ok: false, error: 'tiles must be adjacent' };
      if (a === 'fortify') {
        if (to.owner !== pid) return { ok: false, error: 'fortify: target not yours' };
        if (from.armies <= n) return { ok: false, error: 'fortify: must leave at least 1 behind' };
        from.armies -= n; to.armies += n;
        this.log.push({ round: this.round, seat: pid, text: 'fortify ' + n + ' (' + from.r + ',' + from.c + ')->(' + to.r + ',' + to.c + ')' });
        return { ok: true, state: this.publicView() };
      }
      // attack
      if (to.owner === pid) return { ok: false, error: 'attack: target is yours' };
      if (from.armies <= n) return { ok: false, error: 'attack: must leave at least 1 behind' };
      const atk = n, def = to.armies;
      // simple deterministic-ish combat: attacker power = armies * 1.3
      if (atk * 1.3 > def) {
        to.owner = pid; to.armies = atk - Math.floor(def / 2);
        this.log.push({ round: this.round, seat: pid, text: 'attacked (' + to.r + ',' + to.c + ') with ' + atk + ' vs ' + def + ': captured' });
        if (to.armies < 1) to.armies = 1;
      } else {
        from.armies -= n; to.armies = Math.ceil(to.armies * 0.7);
        this.log.push({ round: this.round, seat: pid, text: 'attacked (' + to.r + ',' + to.c + ') with ' + atk + ' vs ' + def + ': repelled' });
      }
      // eliminate players with no tiles
      for (const s of this.seats) if (s.alive && this.territories(s.id) === 0) { s.alive = false; this.log.push({ round: this.round, text: 'seat ' + s.id + ' (' + s.name + ') eliminated' }); }
      return { ok: true, state: this.publicView() };
    }
    return { ok: false, error: 'unknown action "' + a + '" (deploy|attack|fortify)' };
  }

  botPlay(pid) {
    // simple greedy bot: attack weakest adjacent enemy tile, else fortify toward front
    const mine = this.map.filter(t => t.owner === pid);
    let best = null;
    for (const from of mine) {
      if (from.armies < 2) continue;
      for (const t of this.map) {
        if (t.owner !== pid && t.owner !== undefined && this.adjacent(from, t) && (t.owner === -1 || (t.owner !== pid && this.seats[t.owner] && this.seats[t.owner].alive))) {
          if (from.armies * 1.3 > t.armies + 1) {
            const gain = t.value * (t.owner === -1 ? 1 : 2);
            if (!best || gain > best.gain) best = { from, to: t, gain };
          }
        }
      }
    }
    if (best) { this.doAction(pid, { action: 'attack', r: best.from.r, c: best.from.c, r2: best.to.r, c2: best.to.c, n: best.from.armies - 1 }); return; }
    const tile = mine.find(t => t.armies > 2);
    if (this.reserves[pid] > 0) {
      const front = mine.find(t => this.map.some(o => this.adjacent(t, o) && o.owner !== pid)) || tile;
      if (front) this.doAction(pid, { action: 'deploy', r: front.r, c: front.c, n: this.reserves[pid] });
    }
  }

  publicView() {
    return {
      round: this.round, maxRounds: this.maxRounds,
      started: this.started, winner: this.winner,
      turn: this.started && this.winner == null ? this.turnIdx : null,
      seats: this.seats.map(s => ({ id: s.id, name: s.name, kind: s.kind, alive: s.alive, score: this.score(s.id), reserves: this.reserves[s.id] })),
      map: this.map.map(t => ({ r: t.r, c: t.c, owner: t.owner, armies: t.armies, value: t.value })),
      log: this.log.slice(-50),
    };
  }
}

export { GameState };
