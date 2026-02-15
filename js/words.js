const WORDS = [
  "acid", "acme", "aged", "also", "arch", "army", "atom", "aunt",
  "avid", "axis", "bald", "band", "bark", "base", "beam", "bear",
  "beta", "bird", "bite", "blow", "blue", "blur", "bold", "bolt",
  "bomb", "bone", "book", "bore", "boss", "bred", "brew", "bulk",
  "burn", "buzz", "cage", "cake", "calm", "came", "camp", "cape",
  "card", "cart", "case", "cast", "cave", "cell", "chat", "chip",
  "city", "clad", "clan", "claw", "clay", "clip", "club", "clue",
  "coal", "coat", "code", "coil", "coin", "cold", "colt", "cone",
  "cook", "cool", "cope", "copy", "cord", "core", "cork", "corn",
  "cost", "coup", "crab", "crew", "crop", "crow", "cube", "cult",
  "curb", "cure", "curl", "cute", "dale", "dame", "damp", "dare",
  "dark", "dart", "dash", "data", "dawn", "dead", "deaf", "deal",
  "dear", "debt", "deck", "deed", "deem", "deep", "deer", "demo",
  "deny", "desk", "dial", "dice", "diet", "disc", "dish", "disk",
  "dock", "dome", "done", "doom", "door", "dose", "dove", "down",
  "drag", "draw", "drip", "drop", "drum", "dual", "dude", "duel",
  "duke", "dull", "dumb", "dump", "dune", "dusk", "dust", "duty",
  "each", "earl", "earn", "ease", "east", "echo", "edge", "edit",
  "epic", "euro", "even", "evil", "exam", "exit", "face", "fact",
  "fade", "fail", "fair", "fake", "fall", "fame", "fang", "fare",
  "farm", "fast", "fate", "fawn", "fear", "feat", "feed", "feel",
  "fern", "file", "film", "find", "fine", "fire", "firm", "fish",
  "fist", "five", "flag", "flame", "flat", "fled", "flew", "flip",
  "flock", "flow", "foam", "fold", "folk", "fond", "font", "fool",
  "fork", "form", "fort", "foul", "four", "fowl", "free", "frog",
  "from", "fuel", "full", "fund", "fuse", "fury", "fuzz", "gain",
  "gale", "game", "gang", "gape", "garb", "gate", "gave", "gaze",
  "gear", "gene", "gift", "gild", "girl", "gist", "glad", "glow",
  "glue", "goat", "gold", "golf", "gone", "good", "grab", "gram",
  "gray", "grew", "grid", "grim", "grin", "grip", "grow", "gulf",
  "guru", "gust", "hack", "hail", "hair", "hale", "half", "hall",
  "halt", "hand", "hare", "harp", "hash", "haste", "hawk", "haze",
];

/**
 * Generate a 4-word codename using cryptographically secure randomness.
 * @returns {string} e.g. "bold-echo-fern-grid"
 */
export function generateCodename() {
  const indices = new Uint32Array(4);
  crypto.getRandomValues(indices);
  return Array.from(indices)
    .map(n => WORDS[n % WORDS.length])
    .join("-");
}
