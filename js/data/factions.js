/* Peoples. Each has one unique warrior (trained from the Hearth Age at the building named) and one modest
   bonus, written as the same kind of effect a technology has. The warriors are original designs loosely
   inspired by the history of each people, not copies of anything from another game. */
const FACTIONS = {
  romans:    { name: 'Romans',    unique: 'praetorian',   bonus: 'Builders work 15% faster.',
               blurb: 'Roads, camps and drilled heavy infantry.', effect: { buildSpeed: 0.15 } },
  huns:      { name: 'Huns',      unique: 'steppearcher', bonus: 'Stables train 20% faster.',
               blurb: 'Horse peoples of the steppe who shoot from the saddle.', effect: { trainCls: { cavalry: 0.2 } } },
  norse:     { name: 'Norse',     unique: 'hirdman',      bonus: 'Woodcutters gather 10% faster.',
               blurb: 'Raiders and shipwrights from the northern fjords.', effect: { gather: { wood: 0.1 } } },
  egyptians: { name: 'Egyptians', unique: 'medjay',       bonus: 'Stone and gold are gathered 10% faster.',
               blurb: 'Quarry-masters of the great river.', effect: { gather: { stone: 0.1, gold: 0.1 } } },
  gauls:     { name: 'Gauls',     unique: 'gaesatae',     bonus: 'Farms yield 15% more food.',
               blurb: 'Farmers of rich valleys who fight in a headlong rush.', effect: { farmYield: 0.15 } },
  greeks:    { name: 'Greeks',    unique: 'phalangite',   bonus: 'Technologies are researched 20% faster.',
               blurb: 'City-states of scholars and long-pike phalanxes.', effect: { researchSpeed: 0.2 } },
};
