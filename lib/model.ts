// Token Radar — the ranking model (my own model, written for this entry).
//
// The board ranks protocols that record no token, by what their launch would be
// worth. The value comes only from the sealed snapshot's own figures:
//
//   multiple   = the median market-cap / TVL of the snapshot's LIVE-token
//                protocols in the same category (a comp the snapshot itself
//                carries). A category with fewer than 3 live comps falls back
//                to the global median across all live protocols. Clamped.
//   base       = tvl_usd x multiple
//   fdv        = base x 2.0   (a launch's fully-diluted value runs about 2x
//                its circulating market cap)
//   launch     = a per-category probability the protocol ever launches a
//                token at all (retail protocols launch; institutional vault
//                curators mostly do not). Stated in the dashboard.
//   growth     = clamp(change_7d, -50, +100) per cent
//   growthMult = 1 + (growth / 100) x 0.4
//   maturity   = 0.7 + min(age_days, 1095) / 1095 x 0.3
//                (age_days unknown: 365)
//   implied    = max(1, round(fdv x launch x growthMult x maturity))
//
// The board is the watchlist (the floor) plus every rankable pre-token
// protocol below the floor. A protocol is rankable when it records no token
// (no market cap, no CoinGecko id, no symbol) and is not an exchange, not a
// versioned pool, and not a wrapped, staked or bridged product of a token
// that already trades — the same rule the snapshot's own watchlist uses.
// No protocol name is ever special-cased: the same function scores every row.

/** One protocol entry, exactly the ten fields the sealed snapshot carries. */
export interface SnapProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelParams {
  fdv_uplift: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  min_comps: number;
}

export const PARAMS: ModelParams = {
  fdv_uplift: 2.0,
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 2.5,
  min_comps: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-comps-1';

/** How likely a category is to launch a token at all (my judgement, stated). */
export const LAUNCH_PROBABILITY: Record<string, number> = {
  'Prediction Market': 0.85,
  Dexs: 0.8,
  Lending: 0.75,
  Derivatives: 0.7,
  Yield: 0.7,
  'Yield Aggregator': 0.65,
  CDP: 0.65,
  'Cross Chain Bridge': 0.6,
  Bridge: 0.6,
  'Basis Trading': 0.6,
  'Liquidity Manager': 0.6,
  'Governance Incentives': 0.6,
  RWA: 0.55,
  Payments: 0.55,
  Insurance: 0.5,
  Chain: 0.5,
  'Collateral Markets': 0.5,
  'Onchain Capital Allocator': 0.35,
  Restaking: 0.45,
  CeDeFi: 0.45,
  'Staking Pool': 0.4,
  'Stablecoin Wrapper': 0.4,
  'Risk Curators': 0.3,
};
export const DEFAULT_LAUNCH_PROBABILITY = 0.5;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    launch_probability: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A compact row for data.js (the dashboard renders farm steps from it). */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  launch_probability: number;
  farmability: number;
  farm_steps: string[];
}

/** A live-token protocol, for the dashboard's comparison view. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelParams;
  model_version: string;
  total_protocols: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_multiples: Record<string, number>;
  global_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty number list. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * The category multiples, computed from the snapshot's own live-token
 * protocols: for each category, the median market-cap / TVL of its protocols
 * that already trade (a market cap and a TVL above zero). Categories with
 * too few comps fall back to the global median. All multiples clamped.
 */
export function categoryMultiples(snapshot: Snapshot): { byCategory: Record<string, number>; global: number } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const cat = p.category ?? 'Unknown';
    const list = byCat.get(cat) ?? [];
    list.push(ratio);
    byCat.set(cat, list);
  }
  const clamp = (v: number): number => Math.min(PARAMS.multiple_cap, Math.max(PARAMS.multiple_floor, v));
  const global = all.length > 0 ? clamp(median(all)) : 0.2;
  const byCategory: Record<string, number> = {};
  for (const [cat, ratios] of byCat) {
    if (ratios.length >= PARAMS.min_comps) byCategory[cat] = clamp(median(ratios));
  }
  return { byCategory, global };
}

/** The launch probability for a category (my table, default when unnamed). */
export function launchProbability(category: string | null): number {
  if (category === null) return DEFAULT_LAUNCH_PROBABILITY;
  return LAUNCH_PROBABILITY[category] ?? DEFAULT_LAUNCH_PROBABILITY;
}

/** The implied value one protocol gets, and the model's own inputs for it. */
export function impliedValue(
  p: SnapProtocol,
  asOf: string,
  multiples: { byCategory: Record<string, number>; global: number },
): { implied: number; multiple: number; launch: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const multiple = multiples.byCategory[p.category ?? ''] ?? multiples.global;
  const launch = launchProbability(p.category);
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(PARAMS.growth_cap, Math.max(PARAMS.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * PARAMS.growth_weight;
  const ageForModel = age ?? PARAMS.unknown_age_days;
  const maturityMult =
    PARAMS.maturity_floor + (Math.min(Math.max(ageForModel, 0), PARAMS.maturity_days) / PARAMS.maturity_days) * PARAMS.maturity_range;
  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * multiple * PARAMS.fdv_uplift * launch * growthMult * maturityMult),
  );
  return { implied, multiple, launch, growthPct, growthMult, maturityMult, age };
}

/** A name ending in a release marker is a pool of another protocol, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories the watchlist rule keeps off the board: exchanges and bridged/staked products. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** An exchange's name at the start of a protocol's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** A whole word that marks a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and not an excluded product. */
export function isRankable(p: SnapProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** How farmable a protocol is for a real user, 0-100: chains, growth, category. */
export function farmability(p: SnapProtocol): number {
  let score = 50;
  score += Math.min(15, p.chains.length * 3);
  const g = finite(p.change_7d, 0);
  score += Math.max(-10, Math.min(10, g / 2));
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('lend') || c.includes('yield') || c.includes('prediction') || c.includes('bridge')) score += 15;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) score -= 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main on-chain action, in words a farmer can follow. */
function actionFor(p: SnapProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} (${chain}) and leave the loan open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to the main pool of ${name} on ${chain} and leave it in.`;
  if (c.includes('bridge')) return `Move $${capital} of USDC to ${chain} through ${name}, then use it inside the app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as margin on ${name} and open a single small position.`;
  if (c.includes('prediction')) return `Fund ${name} with $${capital} and take one market position.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Put $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield asset ${name} issues on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy live.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
}

/** One farm step as a single string (action, cost, time), inside 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    stepText(
      'Open a fresh wallet that holds only the funds you plan to farm, and keep its recovery phrase offline, never in a screenshot or a chat.',
      'under $3 of gas for the first transaction',
      '5 minutes',
    ),
    stepText(action, `$${capital} of capital and about $${gas} of gas`, '15 minutes to set up'),
    stepText(
      'Come back once a week and do one real action the protocol counts, a deposit, a swap, a borrow or a vote, and keep the receipt.',
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    stepText(
      `Leave the position open for at least ${hold} days, so the activity spans more than one snapshot.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    stepText(
      "Before you withdraw, open the protocol's own points or rewards page from its official site only. Never pay anyone to claim, and never connect from a link in a DM.",
      'no fee to check',
      '10 minutes',
    ),
    stepText(
      'Write the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.',
      'nothing but the log',
      '5 minutes',
    ),
  ];
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapProtocol[]): Map<string, SnapProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = categoryMultiples(snapshot);
  const chosen = new Map<string, SnapProtocol>();
  // The watchlist is the floor: every slug it names, whether or not it is rankable
  // by the same rule (the house's list is the list; the board covers it whole).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor,
  // by TVL, every one of them — never a replacement for a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: round4(s.multiple),
      launch_probability: s.launch,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's comparison view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const multiples = categoryMultiples(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: PARAMS,
    model_version: MODEL_VERSION,
    total_protocols: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    category_multiples: multiples.byCategory,
    global_multiple: multiples.global,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      multiple: r.model.multiple,
      launch_probability: r.model.launch_probability,
      farmability: farmability({
        slug: r.slug,
        name: r.name,
        category: r.category,
        chains: r.chains,
        tvl_usd: r.tvl_usd,
        change_7d: r.change_7d,
        mcap_usd: r.mcap_usd,
        listed_at: r.listed_at,
        gecko_id: r.gecko_id,
        symbol: r.symbol,
      }),
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than 100`;
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has an empty name`;
    if (/\s/.test(r.slug)) return `${r.slug} carries whitespace`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
