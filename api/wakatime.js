// WakaTime coding stats from the public profile: daily average and all-time total.
// Env: WAKATIME_USER (default faustyu). Needs "display code time publicly" (All Time)
// on in wakatime.com/settings/profile; no API key is used, plain keys can't read stats anyway.

// WakaTime updates every few minutes; no need to ask more often.
const CACHE_MS = 5 * 60 * 1000;

let cache = null;

async function load() {
  const user = process.env.WAKATIME_USER || 'faustyu';
  const res = await fetch(`https://wakatime.com/api/v1/users/@${encodeURIComponent(user)}/stats/all_time`);
  if (!res.ok) throw new Error(`stats/all_time: ${res.status}`);
  const d = (await res.json()).data || {};
  // "including other language" matches the profile's total code time badge.
  const total = d.total_seconds_including_other_language ?? d.total_seconds;
  const average = d.daily_average_including_other_language ?? d.daily_average;
  return {
    dailyAverageSeconds: average != null ? Math.round(average) : null,
    allTimeSeconds: total != null ? Math.round(total) : null,
    ts: Date.now(),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (cache && Date.now() - cache.ts < CACHE_MS) return res.status(200).json(cache.data);
  try {
    const data = await load();
    cache = { ts: Date.now(), data };
    return res.status(200).json(data);
  } catch (err) {
    console.error('[wakatime]', err.message);
    if (cache) return res.status(200).json(cache.data);
    return res.status(502).json({ error: 'WakaTime request failed' });
  }
}
