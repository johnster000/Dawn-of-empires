// Sanity-check the data tables: every reference resolves. Run: node tests/datacheck.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const files = ['js/core/util.js', 'js/core/rng.js', 'js/data/ages.js', 'js/data/terrains.js', 'js/data/buildings.js', 'js/data/units.js', 'js/data/techs.js'];
const src = files.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + `
;(() => {
  const problems = [];
  for (const [k, b] of Object.entries(BUILDINGS)) {
    for (const t of b.trains || []) if (!UNITS[t]) problems.push('building ' + k + ' trains unknown unit ' + t);
    for (const t of b.techs || []) if (!TECHS[t]) problems.push('building ' + k + ' offers unknown tech ' + t);
  }
  for (const [k, u] of Object.entries(UNITS)) if (!BUILDINGS[u.from] || !(BUILDINGS[u.from].trains || []).includes(k)) problems.push('unit ' + k + ' not trained anywhere');
  for (const [k, t] of Object.entries(TECHS)) {
    if (!BUILDINGS[t.from] || !(BUILDINGS[t.from].techs || []).includes(k)) problems.push('tech ' + k + ' not offered by ' + t.from);
    if (t.requires && !TECHS[t.requires]) problems.push('tech ' + k + ' requires unknown ' + t.requires);
  }
  for (const a of AGES) if (a.advance) for (const b of a.advance.need) if (!BUILDINGS[b]) problems.push('age ' + a.id + ' needs unknown building ' + b);
  for (const b of BUILD_MENU.concat(DEFENCE_MENU)) if (!BUILDINGS[b]) problems.push('menu has unknown building ' + b);
  console.log(Object.keys(BUILDINGS).length + ' buildings, ' + Object.keys(UNITS).length + ' units, ' + Object.keys(TECHS).length + ' techs, ' + Object.keys(TERRAINS).length + ' terrains');
  if (problems.length) { console.log(problems.join('\\n')); process.exit(1); }
  console.log('data ok');
})();`;
vm.runInNewContext(src, { console, process });
