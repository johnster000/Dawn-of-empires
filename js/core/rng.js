/* Seeded random numbers and smooth value noise for map generation. */
const RNG = {
  make(seed) {
    let s = (seed >>> 0) || 1;
    const rng = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    rng.int = (a, b) => a + Math.floor(rng() * (b - a + 1));
    rng.range = (a, b) => a + rng() * (b - a);
    rng.chance = (p) => rng() < p;
    rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
    rng.shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
    return rng;
  },
  seedFrom(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; },

  /* Tileable-enough value noise: returns a sampler f(x, y) in [0, 1]. */
  noise(seed, scale) {
    const rng = RNG.make(seed);
    const N = 256, grid = new Float32Array(N * N);
    for (let i = 0; i < grid.length; i++) grid[i] = rng();
    const g = (x, y) => grid[((y & (N - 1)) * N) + (x & (N - 1))];
    const fade = (t) => t * t * (3 - 2 * t);
    const base = (x, y) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = fade(x - x0), fy = fade(y - y0);
      const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
      return U.lerp(U.lerp(a, b, fx), U.lerp(c, d, fx), fy);
    };
    return (x, y, octaves = 4) => {
      let v = 0, amp = 1, freq = 1 / scale, sum = 0;
      for (let o = 0; o < octaves; o++) { v += base(x * freq + o * 37.7, y * freq + o * 91.3) * amp; sum += amp; amp *= 0.5; freq *= 2; }
      return v / sum;
    };
  },
};
