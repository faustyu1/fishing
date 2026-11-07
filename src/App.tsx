import { useEffect, useState, useCallback, useRef, createContext, useContext } from 'react'

interface SpotifyTrack {
  id?: string
  title: string
  artist: string
  url?: string
  art?: string
  isPlaying?: boolean
  progressMs?: number
  durationMs?: number
  device?: { name: string; type: string }
  uri?: string
}

const DEVICE_ICONS: Record<string, JSX.Element> = {
  computer: <path d="M3 5h18v11H3zM8 20h8M12 16v4" />,
  // Laptop icon from Lucide (ISC license): screen plus a flared base, MacBook-like.
  laptop: (
    <>
      <path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z" />
      <path d="M20.054 15.987H3.946" />
    </>
  ),
  // Modern phone front (Pixel-style): tall rounded body, punch-hole camera, no home button.
  smartphone: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="3" />
      <circle cx="12" cy="5.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  tablet: <path d="M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2" />,
  speaker: <path d="M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM12 7h.01M12 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  tv: <path d="M3 6h18v11H3zM8 21h8M9 2l3 4 3-4" />,
}

function DeviceTag({ device }: { device: { name: string; type: string } }) {
  const kind = /macbook|laptop|notebook/i.test(device.name) ? 'laptop' : device.type.toLowerCase()
  const icon = DEVICE_ICONS[kind] || DEVICE_ICONS.speaker
  return (
    <span className="np-device" title={device.type}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {icon}
      </svg>
      <Scramble text={device.name} />
    </span>
  )
}

interface SpotifyData {
  nowPlaying?: SpotifyTrack | null
  recent?: SpotifyTrack[]
  ts?: number
  lastActiveAt?: number | null
  color?: string | null
}

const PAUSED_FOR_MS = 10 * 60 * 1000

// UI language follows the browser: Russian for ru-*, English for everything else.
// ?lang=ru or ?lang=en overrides it for previewing.
function detectLang(): 'ru' | 'en' {
  if (typeof window === 'undefined') return 'en'
  const forced = new URLSearchParams(window.location.search).get('lang')
  if (forced === 'ru' || forced === 'en') return forced
  return /^ru\b/i.test(navigator.language || '') ? 'ru' : 'en'
}
const LANG = detectLang()
if (typeof document !== 'undefined') document.documentElement.lang = LANG

const STRINGS = {
  ru: {
    min: 'м', hour: 'ч', day: 'д', ago: 'назад',
    nowPlaying: 'сейчас играет', paused: 'на паузе', lastPlayed: 'играл недавно', offline: 'офлайн',
    avgPerDay: (d: string) => `в среднем ${d} в день`, total: (d: string) => `всего ${d}`,
    clockTitle: 'моё время (Самара, UTC+4)', city: 'Самара', views: 'просмотры',
    effectOn: 'включить эффект текста', effectOff: 'выключить эффект текста',
    listenOn: 'слушать вместе', listenOff: 'выключить музыку',
    avatar: 'снеговик', contacts: 'контакты', copied: 'скопировано',
    tagline: 'могилка и александр фойд',
  },
  en: {
    min: 'm', hour: 'h', day: 'd', ago: 'ago',
    nowPlaying: 'now playing', paused: 'paused', lastPlayed: 'last played', offline: 'offline',
    avgPerDay: (d: string) => `${d} a day on average`, total: (d: string) => `${d} total`,
    clockTitle: 'my time (Samara, UTC+4)', city: 'Samara', views: 'views',
    effectOn: 'turn text effect on', effectOff: 'turn text effect off',
    listenOn: 'listen along', listenOff: 'stop music',
    avatar: 'snowman', contacts: 'contacts', copied: 'copied',
    tagline: 'mogilka and alexander foyd',
  },
}[LANG]

function ago(ms: number) {
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${Math.max(m, 1)}${STRINGS.min} ${STRINGS.ago}`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}${STRINGS.hour} ${STRINGS.ago}`
  return `${Math.floor(h / 24)}${STRINGS.day} ${STRINGS.ago}`
}

// "now playing" / "paused" (stopped a moment ago) / "offline · 3h ago"
function playState(np: SpotifyTrack, lastActiveAt: number | null, now: number) {
  if (np.isPlaying) return { label: STRINGS.nowPlaying, offline: false }
  if (!lastActiveAt) return { label: STRINGS.lastPlayed, offline: false }
  const idle = now - lastActiveAt
  // No progress means Spotify reported no player at all (closed app, private session),
  // so the track comes from history and "paused" would be a guess.
  if (idle < PAUSED_FOR_MS) return { label: np.progressMs == null ? `${STRINGS.lastPlayed} · ${ago(idle)}` : STRINGS.paused, offline: false }
  return { label: `${STRINGS.offline} · ${ago(idle)}`, offline: true }
}

// Spotify iFrame API: plays the same track as "now playing" in a compact embed.
// Logged-in Spotify users hear the full track, everyone else a 30s preview.
interface EmbedController {
  loadUri(uri: string): void
  play(): void
  pause(): void
  destroy(): void
  addListener(event: string, cb: (e: { data: { isPaused?: boolean } }) => void): void
}
type IFrameAPI = {
  createController(el: HTMLElement, opts: { uri: string; width: string; height: number }, cb: (c: EmbedController) => void): void
}

let iframeApi: Promise<IFrameAPI> | null = null

function loadIframeApi() {
  iframeApi ??= new Promise((resolve, reject) => {
    ;(window as unknown as { onSpotifyIframeApiReady: (api: IFrameAPI) => void }).onSpotifyIframeApiReady = resolve
    const script = document.createElement('script')
    script.src = 'https://open.spotify.com/embed/iframe-api/v1'
    script.async = true
    script.onerror = () => { iframeApi = null; reject(new Error('spotify embed failed')) }
    document.body.appendChild(script)
  })
  return iframeApi
}

function ListenAlong({ uri, on }: { uri?: string; on: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const controller = useRef<EmbedController | null>(null)
  const loaded = useRef<string | undefined>()

  useEffect(() => {
    if (!on || !uri || !host.current) return
    if (controller.current) {
      // Follow track changes.
      if (loaded.current !== uri) {
        loaded.current = uri
        controller.current.loadUri(uri)
      }
      return
    }
    let cancelled = false
    const el = document.createElement('div')
    host.current.appendChild(el)
    loadIframeApi()
      .then((api) => {
        if (cancelled) return
        api.createController(el, { uri, width: '100%', height: 80 }, (c) => {
          controller.current = c
          loaded.current = uri
          c.addListener('ready', () => c.play())
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [on, uri])

  useEffect(() => {
    if (on) return
    controller.current?.destroy()
    controller.current = null
    loaded.current = undefined
    if (host.current) host.current.innerHTML = ''
  }, [on])

  return <div ref={host} className={`listen-along ${on ? 'on' : ''}`} />
}

const pick = (set: string) => set[Math.floor(Math.random() * set.length)]

// Text that assembles itself out of random characters, flickers now and then
// and re-scrambles on hover. Only changed characters scramble, so a ticking clock stays calm.
const POOL_LAT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const POOL_CYR = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯабвгдежзиклмнопрстуфхцчшщэюя'
const POOL_NUM = '0123456789'
const REDUCED = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Calm mode: plain text instead of scrambling. Toggled from the footer, remembered per browser.
const CalmContext = createContext(false)

function initialCalm() {
  try { if (localStorage.getItem('calm') === '1') return true } catch {}
  return REDUCED
}

function noiseFor(c: string) {
  if (/\s/.test(c) || /[^\p{L}\p{N}]/u.test(c)) return c
  if (/\p{N}/u.test(c)) return pick(POOL_NUM)
  return pick(/[а-яё]/i.test(c) ? POOL_CYR : POOL_LAT)
}

function Scramble({ text, className }: { text: string; className?: string }) {
  const el = useRef<HTMLSpanElement>(null)
  // Per character: time until which it shows noise.
  const until = useRef<number[]>([])
  const prev = useRef('')
  const calm = useContext(CalmContext)

  const scramble = useCallback((all: boolean) => {
    const now = performance.now()
    const old = prev.current
    until.current = Array.from(text, (c, i) =>
      all || old[i] !== c ? now + 300 + i * 50 + Math.random() * 600 : (until.current[i] ?? 0),
    )
    prev.current = text
  }, [text])

  useEffect(() => {
    if (calm) { until.current = []; prev.current = text; if (el.current) el.current.textContent = text; return }
    scramble(false)
    const chars = Array.from(text)
    const iv = setInterval(() => {
      const now = performance.now()
      // Rare idle flicker of a single character.
      if (Math.random() < 0.04 && chars.length) {
        const i = Math.floor(Math.random() * chars.length)
        until.current[i] = Math.max(until.current[i] ?? 0, now + 300)
      }
      let out = ''
      for (let i = 0; i < chars.length; i++) out += now < (until.current[i] ?? 0) ? noiseFor(chars[i]) : chars[i]
      if (el.current && el.current.textContent !== out) el.current.textContent = out
    }, 100)
    return () => clearInterval(iv)
  }, [text, scramble, calm])

  return (
    <span className={className} onPointerEnter={calm ? undefined : () => scramble(true)}>
      <span className="sr-only">{text}</span>
      <span ref={el} aria-hidden="true" />
    </span>
  )
}

function samaraTime() {
  return new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Samara' })
}

// Average colour of the cover, pushed towards a readable, saturated tone.
function coverColor(img: HTMLImageElement): string | null {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 24
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, 24, 24)
    const d = ctx.getImageData(0, 0, 24, 24).data
    let r = 0, g = 0, b = 0, wsum = 0
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2])
      const min = Math.min(d[i], d[i + 1], d[i + 2])
      // Prefer saturated, not-too-dark pixels.
      const w = (max - min + 8) * (max > 40 ? 1 : 0.1)
      r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; wsum += w
    }
    if (!wsum) return null
    r /= wsum; g /= wsum; b /= wsum
    const max = Math.max(r, g, b)
    const k = max < 150 ? 150 / Math.max(max, 1) : 1
    return [r, g, b].map((v) => Math.round(Math.min(255, v * k))).join(',')
  } catch {
    return null
  }
}

function loadCover(src?: string): Promise<string | null> {
  if (!src) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(coverColor(img))
    img.onerror = () => resolve(null)
    img.src = src
    setTimeout(() => resolve(null), 1500)
  })
}

async function fetchSpotify(): Promise<SpotifyData> {
  const res = await fetch('/api/spotify', { cache: 'no-store' })
  if (!res.ok) throw new Error('bad status')
  const data: SpotifyData = await res.json()
  // Wait for the cover so art, text and colour appear together.
  data.color = await loadCover(data.nowPlaying?.art)
  return data
}

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function NpProgress({ np, syncedAt }: { np: SpotifyTrack; syncedAt: number }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!np.isPlaying) return
    const iv = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(iv)
  }, [np.isPlaying])

  if (!np.durationMs || np.progressMs == null) return null
  const elapsed = np.isPlaying ? Math.min(Math.max(now - syncedAt, 0), 60000) : 0
  const pos = Math.min(np.progressMs + elapsed, np.durationMs)

  return (
    <span className="np-progress" aria-hidden="true">
      <Scramble className="np-time" text={fmt(pos)} />
      <span className="np-bar"><span style={{ width: `${(pos / np.durationMs) * 100}%` }} /></span>
      <Scramble className="np-time" text={fmt(np.durationMs)} />
    </span>
  )
}

type Season = 'winter' | 'spring' | 'summer' | 'autumn'

// Season by the month in Samara; ?season=summer overrides it for previewing.
function currentSeason(): Season {
  const forced = new URLSearchParams(window.location.search).get('season')
  if (forced === 'winter' || forced === 'spring' || forced === 'summer' || forced === 'autumn') return forced
  const month = Number(new Date().toLocaleString('en-US', { timeZone: 'Europe/Samara', month: 'numeric' }))
  if (month === 12 || month <= 2) return 'winter'
  if (month <= 5) return 'spring'
  if (month <= 8) return 'summer'
  return 'autumn'
}

const SEASON = currentSeason()

// Background particles per season. size/fall are [base, extra at full depth]; area is px² per particle.
const SEASON_LOOK: Record<Season, {
  kind: 'snow' | 'petal' | 'firefly' | 'leaf'
  colors: string[]
  size: [number, number]
  fall: [number, number]
  sway: number
  area: number
  max: number
}> = {
  winter: { kind: 'snow', colors: ['#ffffff'], size: [0.7, 2.6], fall: [18, 70], sway: 12, area: 7000, max: 260 },
  spring: { kind: 'petal', colors: ['#ffc4d8', '#ffdbe7', '#ffffff', '#f7a8c4'], size: [2.5, 4], fall: [14, 30], sway: 30, area: 13000, max: 110 },
  summer: { kind: 'firefly', colors: ['#e9ff8a', '#fff1a1', '#c8ff7a'], size: [0.8, 1.4], fall: [0, 0], sway: 14, area: 18000, max: 70 },
  autumn: { kind: 'leaf', colors: ['#e8833a', '#d9542b', '#f2b33d', '#b8452a', '#c9772c'], size: [4, 5], fall: [20, 40], sway: 40, area: 15000, max: 80 },
}

const SEASON_CONFETTI: Record<Season, string[]> = {
  winter: ['⛄', '❄️'],
  spring: ['🌸', '🌷'],
  summer: ['☀️', '🌻'],
  autumn: ['🍂', '🍁'],
}

const CONFETTI = [...SEASON_CONFETTI[SEASON], '🎉', '⭐', '✨']
const CONFETTI_COLORS = ['#ffffff', '#d4d4d4', '#9a9a9a', '#5e5e5e']

function confetti(x: number, y: number) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  for (let i = 0; i < 34; i++) {
    const el = document.createElement('span')
    el.className = 'confetti'
    if (i % 3 === 0) {
      el.textContent = CONFETTI[Math.floor(Math.random() * CONFETTI.length)]
    } else {
      el.classList.add('confetti-bit')
      el.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]
    }
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    document.body.appendChild(el)

    const angle = Math.random() * Math.PI * 2
    const dist = 80 + Math.random() * 160
    const dx = Math.cos(angle) * dist
    const dy = Math.sin(angle) * dist - 60
    const rot = (Math.random() - 0.5) * 720
    el.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot / 2}deg) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${dx * 1.2}px), calc(-50% + ${dy + 220}px)) rotate(${rot}deg) scale(0.9)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 600, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)' },
    ).onfinish = () => el.remove()
  }
}

function hasZeroBits(buf: ArrayBuffer, bits: number) {
  const bytes = new Uint8Array(buf)
  let i = 0
  for (; bits >= 8; bits -= 8) if (bytes[i++] !== 0) return false
  return bits === 0 || bytes[i] >> (8 - bits) === 0
}

// Proof of work the views API asks for: sha256(`${challenge}:${solution}`) with `bits` leading zero bits.
async function solvePow(challenge: string, bits: number) {
  const enc = new TextEncoder()
  for (let n = 0; ; n++) {
    const solution = n.toString(36)
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${challenge}:${solution}`))
    if (hasZeroBits(digest, bits)) return solution
  }
}

const MIN_DWELL_MS = 3200

// Coding stats from WakaTime; null until loaded or when the API is unavailable.
function useWakatime() {
  const [data, setData] = useState<{ dailyAverageSeconds: number | null; allTimeSeconds: number | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = () =>
      fetch('/api/wakatime', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && d) setData(d) })
        .catch(() => {})
    load()
    const iv = setInterval(() => { if (!document.hidden) load() }, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])
  return data
}

function duration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const h = Math.floor(m / 60)
  const { hour, min } = STRINGS
  if (h >= 100) return `${h}${hour}`
  return h ? `${h}${hour} ${m % 60}${min}` : `${m}${min}`
}

// "в среднем 2ч 5м в день · всего 725ч" / "2h 5m a day on average · 725h total"
function codingLine(average: number | null, allTime: number | null) {
  const parts: string[] = []
  if (average) parts.push(STRINGS.avgPerDay(duration(average)))
  if (allTime) parts.push(STRINGS.total(duration(allTime)))
  return parts.join(' · ')
}

function useViews() {
  const [views, setViews] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    let counted = false
    // Each browser counts once ever, not once per tab session: phones change IP often,
    // so the server's once-per-IP-per-day rule alone counted the same people again and again.
    // Opening the site once with ?me marks this browser as the owner's, which never counts.
    try {
      if (new URLSearchParams(location.search).has('me')) localStorage.setItem('me', '1')
      counted = localStorage.getItem('viewed') === '1' || localStorage.getItem('me') === '1'
    } catch {}

    async function run() {
      const res = await fetch('/api/views', { cache: 'no-store' })
      if (!res.ok) return
      const { count, challenge, bits } = await res.json()
      if (cancelled) return
      setViews(count)
      if (counted || !challenge || !crypto?.subtle) return

      // The server only accepts a view after the page has been open for a few seconds.
      const started = Date.now()
      const solution = await solvePow(challenge, bits)
      const wait = MIN_DWELL_MS - (Date.now() - started)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      while (document.hidden && !cancelled) await new Promise((r) => setTimeout(r, 1000))
      if (cancelled) return

      const post = await fetch('/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge, solution }),
      })
      if (!post.ok) return
      const data = await post.json()
      if (cancelled) return
      setViews(data.count)
      try { localStorage.setItem('viewed', '1') } catch {}
    }

    run().catch(() => {})
    return () => { cancelled = true }
  }, [])
  return views
}

// Start the first request at module load, before React mounts.
const firstSpotify = fetchSpotify()
firstSpotify.catch(() => {})

const AVATARS = ['https://t.me/i/userpic/320/faustyu.jpg', '/avatar-hardcode.jpg']

interface Social {
  key: string
  href: string
  label: string
  tip: string
  copy?: string
  svg: JSX.Element
}

const SOCIALS: Social[] = [
  {
    key: 't',
    href: 'https://t.me/faustyu',
    label: 'Telegram — @faustyu',
    tip: '@faustyu',
    svg: (
      <svg viewBox="-1.18 -1.51 25.5 25.5" fill="currentColor" aria-hidden="true">
        <path d="M21.9 4.3 18.7 19.4c-.24 1.06-.87 1.32-1.76.82l-4.86-3.58-2.35 2.26c-.26.26-.48.48-.98.48l.35-4.95L18.1 5.9c.4-.36-.08-.56-.62-.2L6.55 12.4l-4.8-1.5c-1.04-.32-1.06-1.04.22-1.54l18.8-7.24c.86-.32 1.62.2 1.33 2.18z" />
      </svg>
    ),
  },
  {
    key: 'g',
    href: 'https://github.com/faustyu1',
    label: 'GitHub — @faustyu1',
    tip: '@faustyu1',
    svg: (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.22-3.37-1.22-.46-1.18-1.11-1.5-1.11-1.5-.9-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.05 0-1.11.39-2.02 1.03-2.74-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.74 0 3.92-2.34 4.78-4.57 5.04.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.03 10.03 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
      </svg>
    ),
  },
  {
    key: 'k',
    href: 'https://x.com/dshashimov',
    label: 'X — @dshashimov',
    tip: '@dshashimov',
    svg: (
      <svg viewBox="-30 -30 360 360.251" fill="currentColor" aria-hidden="true">
        <path d="M178.57 127.15 290.27 0h-26.46l-97.03 110.38L89.34 0H0l117.13 166.93L0 300.25h26.46l102.4-116.59 81.8 116.59h89.34M36.01 19.54H76.66l187.13 262.13h-40.66"/>
      </svg>
    ),
  },
]

export default function App() {
  const [toastMessage, setToastMessage] = useState('')
  const [clock, setClock] = useState('--:--:--')
  const [now, setNow] = useState(Date.now())
  const [listening, setListening] = useState(false)
  const [calm, setCalm] = useState(initialCalm)
  // The music block unfolds once on load; after that it may overflow (hover lift, shadows).
  const [grown, setGrown] = useState(false)
  const toggleCalm = () => setCalm((v) => {
    try { localStorage.setItem('calm', v ? '0' : '1') } catch {}
    return !v
  })
  // Telegram userpic first; the saved copy if Telegram fails, then the snowman.
  const [avatarIdx, setAvatarIdx] = useState(0)
  const nextAvatar = () => setAvatarIdx((i) => i + 1)
  const views = useViews()
  const waka = useWakatime()

  const [spotify, setSpotify] = useState<{
    np: SpotifyTrack | null
    recent: SpotifyTrack[]
    color: string | null
    lastActiveAt: number | null
    syncedAt: number
    loaded: boolean
  }>({ np: null, recent: [], color: null, lastActiveAt: null, syncedAt: 0, loaded: false })
  const trackEnd = useRef<ReturnType<typeof setTimeout>>()

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    const timer = setTimeout(() => setToastMessage(''), 1600)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const tick = () => { setClock(samaraTime()); setNow(Date.now()) }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return

    const canvas = document.getElementById('stars') as HTMLCanvasElement
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: true }) as CanvasRenderingContext2D
    if (!ctx) return

    let w = 0, h = 0, dpr = 1
    const look = SEASON_LOOK[SEASON]
    // z is depth: near particles are bigger, faster, brighter.
    type Bit = {
      x: number; y: number; z: number; r: number; vy: number
      phase: number; sway: number; rot: number; spin: number; color: string
    }
    type Star = { x: number; y: number; r: number; a: number; s: number }
    let bits: Bit[] = []
    let stars: Star[] = []
    let wind = 0, windTarget = 0
    let raf = 0
    let last = performance.now()

    function makeBit(anywhere: boolean): Bit {
      const z = Math.random() ** 1.6
      return {
        x: Math.random() * w,
        y: anywhere || look.kind === 'firefly' ? Math.random() * h : -20 - Math.random() * 40,
        z,
        r: look.size[0] + z * look.size[1],
        vy: look.fall[0] + z * look.fall[1],
        phase: Math.random() * Math.PI * 2,
        sway: look.sway * (0.5 + Math.random()),
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 3,
        color: look.colors[Math.floor(Math.random() * look.colors.length)],
      }
    }

    function init() {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const n = Math.min(look.max, Math.floor((w * h) / look.area))
      bits = Array.from({ length: n }, () => makeBit(true))
      // A few faint stars in the upper sky.
      stars = Array.from({ length: Math.min(70, Math.floor((w * h) / 26000)) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h * 0.6,
        r: Math.random() * 0.9 + 0.3,
        a: Math.random() * 6,
        s: Math.random() * 0.8 + 0.2,
      }))
    }

    function draw(b: Bit) {
      ctx.fillStyle = b.color
      if (look.kind === 'snow') {
        ctx.globalAlpha = 0.25 + b.z * 0.65
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.r, 0, 7)
        ctx.fill()
        return
      }
      if (look.kind === 'firefly') {
        // Slow pulse; the glow is a soft halo plus a bright core.
        const glow = Math.max(0, Math.sin(b.rot))
        ctx.globalAlpha = 0.15 + glow * 0.35
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.r * 4, 0, 7)
        ctx.fill()
        ctx.globalAlpha = 0.3 + glow * 0.7
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.r, 0, 7)
        ctx.fill()
        return
      }
      // Leaf or petal: a tumbling ellipse; scaleX by cos(rot) fakes a 3D flip.
      ctx.globalAlpha = 0.45 + b.z * 0.5
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.rotate(b.rot * 0.6)
      ctx.scale(Math.max(Math.abs(Math.cos(b.rot)), 0.2), 1)
      ctx.beginPath()
      if (look.kind === 'leaf') {
        ctx.moveTo(0, -b.r)
        ctx.quadraticCurveTo(b.r * 0.9, 0, 0, b.r)
        ctx.quadraticCurveTo(-b.r * 0.9, 0, 0, -b.r)
      } else {
        ctx.ellipse(0, 0, b.r * 0.6, b.r, 0, 0, 7)
      }
      ctx.fill()
      ctx.restore()
    }

    function loop(now: number) {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      wind += (windTarget - wind) * 0.02
      ctx.clearRect(0, 0, w, h)

      ctx.fillStyle = '#dbe8ff'
      for (const s of stars) {
        s.a += s.s * dt
        ctx.globalAlpha = 0.15 + Math.abs(Math.sin(s.a)) * 0.35 * (1 - s.y / (h * 0.6))
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, 7)
        ctx.fill()
      }

      for (const b of bits) {
        b.phase += dt * (0.6 + b.z)
        b.rot += b.spin * dt
        if (look.kind === 'firefly') {
          // Wander in loops instead of falling.
          b.x += (Math.cos(b.phase * 0.7) * b.sway + wind * 10) * dt
          b.y += Math.sin(b.phase) * b.sway * dt - 4 * dt
          if (b.y < -20) b.y = h + 20
          else if (b.y > h + 20) b.y = -20
        } else {
          b.y += b.vy * dt
          b.x += (Math.sin(b.phase) * b.sway * 0.03 + wind * (0.4 + b.z)) * dt * 60
          if (b.y > h + 20) Object.assign(b, makeBit(false))
        }
        if (b.x > w + 20) b.x = -20
        else if (b.x < -20) b.x = w + 20
        draw(b)
      }
      ctx.globalAlpha = 1

      raf = requestAnimationFrame(loop)
    }

    // Particles drift gently towards the side the cursor is on.
    const onMove = (e: PointerEvent) => { windTarget = ((e.clientX / w) - 0.5) * 1.2 }
    window.addEventListener('pointermove', onMove)

    init()
    raf = requestAnimationFrame(loop)

    const onResize = () => init()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])

  const handleSocialClick = (e: React.MouseEvent<HTMLAnchorElement>, social: typeof SOCIALS[0]) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const ripple = document.createElement('span')
    ripple.className = 'ripple'
    const size = Math.max(rect.width, rect.height)
    ripple.style.width = ripple.style.height = `${size}px`
    ripple.style.left = `${e.clientX - rect.left}px`
    ripple.style.top = `${e.clientY - rect.top}px`
    e.currentTarget.appendChild(ripple)
    setTimeout(() => ripple.remove(), 450)

    if (social.copy && navigator.clipboard) {
      navigator.clipboard.writeText(social.copy).then(() => {
        showToast(`${STRINGS.copied}  ${social.copy}`)
      }).catch(() => {})
    }
  }

  useEffect(() => {
    let cancelled = false

    async function load(attempt = 0, first = false) {
      try {
        const data = await (first ? firstSpotify : fetchSpotify())
        if (cancelled) return

        const np = data.nowPlaying ? { ...data.nowPlaying } : null
        setSpotify((prev) => {
          // If the track changed while the page is open, the previous one is history
          // even if the server (another instance, Spotify lag) doesn't know it yet.
          const local = prev.np && prev.np.id !== np?.id ? [{ ...prev.np, isPlaying: false }] : []
          const seen = new Set([np?.id])
          const recent = [...local, ...(data.recent || []), ...prev.recent]
            .filter((t) => t.id && !seen.has(t.id) && seen.add(t.id))
            .slice(0, 3)
          return {
            np,
            recent,
            color: data.color || (np?.id === prev.np?.id ? prev.color : null),
            lastActiveAt: data.lastActiveAt ?? prev.lastActiveAt,
            syncedAt: data.ts || Date.now(),
            loaded: true,
          }
        })

        // Refresh right when the current track should end instead of waiting for the next poll.
        clearTimeout(trackEnd.current)
        if (np?.isPlaying && np.durationMs && np.progressMs != null) {
          const left = np.durationMs - np.progressMs - (Date.now() - (data.ts || Date.now()))
          if (left > 0 && left < 15000) trackEnd.current = setTimeout(() => load(), left + 1500)
        }
      } catch {
        if (!cancelled && attempt < 2) {
          setTimeout(() => load(attempt + 1), 800)
        } else if (!cancelled) {
          setSpotify((prev) => ({ ...prev, loaded: true }))
        }
      }
    }

    load(0, true)
    const iv = setInterval(() => { if (!document.hidden) load() }, 5000)
    // Catch up immediately when the tab becomes visible again.
    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(iv)
      clearTimeout(trackEnd.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])



  const state = spotify.np ? playState(spotify.np, spotify.lastActiveAt, now) : null

  return (
    <CalmContext.Provider value={calm}>
    <div>
      <canvas id="stars" aria-hidden="true" />

      <main
        className={`card ${spotify.color ? 'has-color' : ''}`}
        id="card"
        style={spotify.color ? ({ '--np-rgb': spotify.color } as React.CSSProperties) : undefined}
      >
        <button
          type="button"
          className="portrait-btn"
          aria-label={STRINGS.avatar}
          onClick={(e) => {
            const el = e.currentTarget
            // Restart the shake animation on every click.
            el.classList.remove('is-shaking')
            void el.offsetWidth
            el.classList.add('is-shaking')
            const r = el.getBoundingClientRect()
            confetti(r.left + r.width / 2, r.top + r.height / 2)
          }}
          onAnimationEnd={(e) => e.currentTarget.classList.remove('is-shaking')}
        >
          {avatarIdx < AVATARS.length ? (
            <img
              key={AVATARS[avatarIdx]}
              className="portrait"
              src={AVATARS[avatarIdx]}
              alt="Daniil"
              draggable={false}
              onError={nextAvatar}
              onLoad={(e) => { if (e.currentTarget.naturalWidth <= 1) nextAvatar() }}
            />
          ) : (
            <span className="portrait portrait-fallback" role="img" aria-label="Daniil">⛄</span>
          )}
        </button>

        <div className="name"><Scramble text="Daniil" /></div>

        <p className="intro"><Scramble text={STRINGS.tagline} /></p>

        <hr className="rule" />

        <nav className="socials" aria-label={STRINGS.contacts}>
          {SOCIALS.map((social) => (
            <a
              key={social.key}
              className="social"
              href={social.href}
              target="_blank"
              rel="noopener noreferrer"
              data-tip={social.tip}
              aria-label={social.label}
              onClick={(e) => handleSocialClick(e, social)}
            >
              {social.svg}
            </a>
          ))}
        </nav>

        <section
          className={`spotify ${grown ? 'grown' : ''} ${spotify.np?.isPlaying ? 'is-playing' : ''} ${state?.offline ? 'is-offline' : ''}`}
          aria-label="Spotify"
          onAnimationEnd={(e) => { if (e.target === e.currentTarget) setGrown(true) }}
        >
          <div className="spotify-inner">
            <hr className="rule" />
            {spotify.np ? (
              <a key={spotify.np.id || spotify.np.title} className="np np-enter" href={spotify.np.url || '#'} target="_blank" rel="noopener noreferrer">
                <span
                  className="np-art"
                  style={{ backgroundImage: spotify.np.art ? `url("${spotify.np.art}")` : undefined }}
                  aria-hidden="true"
                />
                <span className="np-body">
                  <span className="np-label">
                    <Scramble className="np-state" text={state?.label ?? ''} />
                    {spotify.np.isPlaying && spotify.np.device && <DeviceTag device={spotify.np.device} />}
                  </span>
                  <Scramble className="np-title" text={spotify.np.title} />
                  <Scramble className="np-artist" text={spotify.np.artist} />
                  {!state?.offline && <NpProgress np={spotify.np} syncedAt={spotify.syncedAt} />}
                </span>
                <span className="np-eq" aria-hidden="true"><i /><i /><i /><i /></span>
              </a>
            ) : !spotify.loaded ? (
              <div className="np is-loading" aria-busy="true">
                <span className="np-art" aria-hidden="true" />
                <span className="np-body">
                  <span className="np-label"><Scramble text="spotify" /></span>
                  <span className="sk sk-title" />
                  <span className="sk sk-artist" />
                </span>
              </div>
            ) : null}
            <ListenAlong uri={spotify.np?.uri} on={listening} />
            {!spotify.loaded && (
              <ul className="recent" aria-hidden="true">
                {[0, 1, 2].map((i) => <li key={i}><span className="sk sk-line" /></li>)}
              </ul>
            )}
            {spotify.recent?.length > 0 && (
              <ul className="recent">
                {spotify.recent.slice(0, 3).map((t, i) => (
                  <li key={t.id || i} className="np-enter" style={{ animationDelay: `${80 + i * 60}ms` }}>
                    {t.url ? (
                      <a href={t.url} target="_blank" rel="noopener noreferrer">
                        <span className="r-dot">♪</span>
                        <span className="r-text"><Scramble text={t.title} /> <Scramble className="r-artist" text={`— ${t.artist}`} /></span>
                      </a>
                    ) : (
                      <span>
                        <span className="r-dot">♪</span>
                        <span className="r-text"><Scramble text={t.title} /> <Scramble className="r-artist" text={`— ${t.artist}`} /></span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          </section>

        {waka && (waka.dailyAverageSeconds || waka.allTimeSeconds) ? (
          <p className="waka" title="WakaTime">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m8 6-6 6 6 6M16 6l6 6-6 6" />
            </svg>
            <Scramble text={codingLine(waka.dailyAverageSeconds, waka.allTimeSeconds)} />
          </p>
        ) : null}

        <footer className="foot">
          <span className="clock" title={STRINGS.clockTitle}>
            <Scramble text={clock} /> <Scramble className="clock-tz" text={STRINGS.city} />
          </span>
          <span className="foot-right">
            {views != null && <span className="views" title={STRINGS.views}>👁 <Scramble text={views.toLocaleString(LANG === 'ru' ? 'ru-RU' : 'en-US')} /></span>}
            <button
              type="button"
              className={`sound-toggle ${calm ? 'on' : ''}`}
              onClick={toggleCalm}
              aria-pressed={calm}
              aria-label={calm ? STRINGS.effectOn : STRINGS.effectOff}
              title={calm ? STRINGS.effectOn : STRINGS.effectOff}
            >
              {/* Accessibility icon from Lucide (ISC license): person in a wheelchair. */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="16" cy="4" r="1" />
                <path d="m18 19 1-7-6 1" />
                <path d="m5 8 3-3 5.5 3-2.36 3.5" />
                <path d="M4.24 14.5a5 5 0 0 0 6.88 6" />
                <path d="M13.76 17.5a5 5 0 0 0-6.88-6" />
              </svg>
            </button>
            <button
              type="button"
              className={`sound-toggle ${listening ? 'on' : ''}`}
              onClick={() => setListening((v) => !v)}
              disabled={!spotify.np?.uri}
              aria-pressed={listening}
              aria-label={listening ? STRINGS.listenOff : STRINGS.listenOn}
              title={listening ? STRINGS.listenOff : STRINGS.listenOn}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5 6 9H2v6h4l5 4V5z" />
                {listening ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="m22 9-6 6M16 9l6 6" />}
              </svg>
            </button>
          </span>
        </footer>
      </main>

      <div className={`toast ${toastMessage ? 'show' : ''}`} role="status" aria-live="polite">
        {toastMessage}
      </div>
    </div>
    </CalmContext.Provider>
  )
}
