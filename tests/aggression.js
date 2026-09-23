/* Bot temper: early on a bot only attacks whoever has hurt it; past its peace age it attacks anyone.
   Run: node tests/aggression.js */
const { launch } = require('./lib');
(async () => {
  const H = await launch();
  await H.start({ enemies: 2, difficulty: 'normal', seedText: 'temper', reveal: true });
  const ok = (name, pass, info) => { console.log((pass ? 'ok   ' : 'FAIL ') + name, info ? JSON.stringify(info) : ''); if (!pass) process.exitCode = 1; };
  const setup = () => H.page.evaluate(() => {
    const p = Game.players[1], S = p.ai, home = S.home || p.buildings('townhall')[0];
    for (const u of p.units()) if (u.type !== 'villager') u.dead = true;
    for (let i = 0; i < 20; i++) Game.units.push(Ent.unit('spearman', 1, home.x + 3 + (i % 5), home.y + 3 + Math.floor(i / 5)));
    Game.units = Game.units.filter((u) => !u.dead);
    S.attacking = false; S.attackTarget = null; S.lastAttack = -Infinity; Game.time = Math.max(Game.time, 400);
    Sim.refreshLists && Sim.refreshLists();
  });
  const decide = () => H.page.evaluate(() => { const p = Game.players[1], S = p.ai; const mil = p.units().filter((u) => u.type !== 'villager'); AI.attack(p, S, mil); return { attacking: S.attacking, target: S.attackTarget ? S.attackTarget.owner : null, warlike: AI.warlike(p), age: p.age }; });

  await setup();
  let r = await decide();
  ok('Dawn Age bot with a big army leaves everyone alone', !r.attacking, r);

  // the player draws first blood
  await H.page.evaluate(() => { const v = Game.players[1].units('villager')[0]; const s = Ent.unit('spearman', 0, v.x + 1, v.y); Game.units.push(s); Sim.damage(v, s); s.dead = true; Game.units = Game.units.filter((u) => !u.dead); });
  r = await decide();
  ok('a provoked bot hits back at the one who hurt it', r.attacking && r.target === 0, r);

  // grudges fade
  await setup();
  await H.page.evaluate(() => { const p = Game.players[1]; for (const k in p.grudge) p.grudge[k] -= 1000; });
  r = await decide();
  ok('an old grudge is forgotten', !r.attacking, r);

  // bot 2 hit bot 1: bot 1 goes after bot 2, not the player
  await setup();
  await H.page.evaluate(() => { Game.players[1].grudge[2] = Game.time; });
  r = await decide();
  ok('it targets the provoker, not the nearest player', r.attacking && r.target === 2, r);

  // Forge Age on normal: fair game for all
  await setup();
  await H.page.evaluate(() => { const p = Game.players[1]; p.grudge = {}; p.age = 2; });
  r = await decide();
  ok('past its peace age it attacks unprovoked', r.attacking && r.warlike, r);

  // easy bots stay patient longer
  await H.page.evaluate(() => { const p = Game.players[1]; p.difficulty = 'easy'; p.ai.D = DIFF.easy; });
  await setup();
  await H.page.evaluate(() => { const p = Game.players[1]; p.grudge = {}; p.age = 2; });
  r = await decide();
  ok('an easy bot in the Forge Age still waits to be provoked', !r.attacking, r);

  // temper from the setup screen
  const temper = async (t, age, grudge) => { await H.page.evaluate(([t, age, grudge]) => { const p = Game.players[1]; p.difficulty = 'normal'; p.ai.D = DIFF.normal; p.ai.T = TEMPER[t]; p.grudge = grudge ? { 0: Game.time - grudge } : {}; p.age = age; }, [t, age, grudge]); await setup(); await H.page.evaluate(([age, grudge]) => { const p = Game.players[1]; p.age = age; p.grudge = grudge ? { 0: Game.time - grudge } : {}; }, [age, grudge]); return decide(); };
  r = await temper('aggressive', 1, 0);
  ok('an aggressive bot attacks unprovoked a whole age sooner', r.attacking && r.warlike, r);
  r = await temper('chill', 2, 0);
  ok('a chill bot still waits in the Forge Age', !r.attacking && !r.warlike, r);
  await H.page.evaluate(() => { Game.time = 600; });
  r = await temper('chill', 3, 0);
  ok('a chill bot turns in the Empire Age', r.attacking, r);
  r = await temper('chill', 0, 250);
  ok('a chill bot forgets a grudge sooner', !r.attacking, r);
  r = await temper('normal', 0, 250);
  ok('a normal bot still remembers it', r.attacking && r.target === 0, r);
  await H.page.evaluate(() => { Game.players[1].ai.T = TEMPER.normal; });
  // save round trip keeps grudges
  const g = await H.page.evaluate(() => { Game.players[1].grudge = { 0: Game.time }; const d = Save.serialize(); Save.restore(JSON.parse(JSON.stringify(d))); return Game.players[1].grudge; });
  ok('grudges survive a save', g && g[0] != null, g);
  console.log('ERRORS', H.errors.length ? H.errors.join('\n') : 'none');
  await H.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
