import { useEffect, useState, useCallback, useRef } from 'react'

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
      {device.name}
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

function ago(ms: number) {
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${Math.max(m, 1)}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// "now playing" / "paused" (stopped a moment ago) / "offline · 3h ago"
function playState(np: SpotifyTrack, lastActiveAt: number | null, now: number) {
  if (np.isPlaying) return { label: 'now playing', offline: false }
  if (!lastActiveAt) return { label: 'last played', offline: false }
  const idle = now - lastActiveAt
  if (idle < PAUSED_FOR_MS) return { label: 'paused', offline: false }
  return { label: `offline · ${ago(idle)}`, offline: true }
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
      <span className="np-time">{fmt(pos)}</span>
      <span className="np-bar"><span style={{ width: `${(pos / np.durationMs) * 100}%` }} /></span>
      <span className="np-time">{fmt(np.durationMs)}</span>
    </span>
  )
}

const CONFETTI = ['⛄', '❄️', '🎉', '⭐', '✨']
const CONFETTI_COLORS = ['#a988ff', '#ff5c8a', '#ffd166', '#4cd4ff', '#7dffb0']

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

function useViews() {
  const [views, setViews] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    let counted = false
    try { counted = sessionStorage.getItem('viewed') === '1' } catch {}

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
      try { sessionStorage.setItem('viewed', '1') } catch {}
    }

    run().catch(() => {})
    return () => { cancelled = true }
  }, [])
  return views
}

// Start the first request at module load, before React mounts.
const firstSpotify = fetchSpotify()
firstSpotify.catch(() => {})

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
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
      <svg viewBox="0 0 300 300.251" fill="currentColor" aria-hidden="true">
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
  const [avatarOk, setAvatarOk] = useState(true)
  const views = useViews()

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

    let w = 0, h = 0
    type Star = { x: number; y: number; r: number; a: number; s: number }
    let pts: Star[] = []
    type Meteor = { x: number; y: number; vx: number; vy: number; len: number; life: number; max: number; hue: string }
    let meteors: Meteor[] = []
    let nextMeteor = 0
    let raf = 0

    function spawnMeteor(now: number) {
      // Diagonal fall from the upper area, down-left, tinted like the site accent.
      const speed = 9 + Math.random() * 7
      const angle = (Math.PI / 180) * (125 + Math.random() * 20)
      meteors.push({
        x: w * (0.25 + Math.random() * 0.85),
        y: -20 + Math.random() * h * 0.35,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        len: 90 + Math.random() * 110,
        life: 0,
        max: 55 + Math.random() * 35,
        hue: Math.random() < 0.6 ? '169,136,255' : '244,241,251',
      })
      nextMeteor = now + 1400 + Math.random() * 3200
    }

    function init() {
      w = canvas.width = window.innerWidth
      h = canvas.height = window.innerHeight

      const n = Math.min(140, Math.floor((w * h) / 12000))
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.3 + 0.3,
        a: Math.random(),
        s: Math.random() * 0.02 + 0.004,
      }))
    }

    function loop(now = 0) {
      ctx.clearRect(0, 0, w, h)
      for (const p of pts) {
        p.a += p.s
        const alpha = 0.35 + Math.abs(Math.sin(p.a)) * 0.55
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, 7)
        ctx.fillStyle = `rgba(255,255,255,${alpha})`
        ctx.fill()
      }

      if (now >= nextMeteor && meteors.length < 3) spawnMeteor(now)

      meteors = meteors.filter((m) => m.life < m.max && m.y < h + 200)
      for (const m of meteors) {
        m.life++
        m.x += m.vx
        m.y += m.vy
        const fade = Math.sin((m.life / m.max) * Math.PI)
        const speed = Math.hypot(m.vx, m.vy)
        const tx = m.x - (m.vx / speed) * m.len
        const ty = m.y - (m.vy / speed) * m.len
        const grad = ctx.createLinearGradient(m.x, m.y, tx, ty)
        grad.addColorStop(0, `rgba(${m.hue},${0.95 * fade})`)
        grad.addColorStop(1, `rgba(${m.hue},0)`)
        ctx.strokeStyle = grad
        ctx.lineWidth = 1.6
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(m.x, m.y)
        ctx.lineTo(tx, ty)
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(m.x, m.y, 1.8, 0, 7)
        ctx.fillStyle = `rgba(255,255,255,${fade})`
        ctx.shadowColor = `rgba(${m.hue},1)`
        ctx.shadowBlur = 10
        ctx.fill()
        ctx.shadowBlur = 0
      }

      raf = requestAnimationFrame(loop)
    }

    init()
    nextMeteor = performance.now() + 600
    raf = requestAnimationFrame(loop)

    const onResize = () => init()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
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
        showToast('copied  ' + social.copy)
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
          aria-label="снеговик"
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
          {avatarOk ? (
            <img
              className="portrait"
              src="avatar-hardcode.jpg"
              alt="4"
              draggable={false}
              onError={() => setAvatarOk(false)}
              onLoad={(e) => { if (e.currentTarget.naturalWidth <= 1) setAvatarOk(false) }}
            />
          ) : (
            <span className="portrait portrait-fallback" role="img" aria-label="4">⛄</span>
          )}
        </button>

        <div className="name">4</div>

        <p className="intro">CEO</p>

        <hr className="rule" />

        <nav className="socials" aria-label="contacts">
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
          className={`spotify ${spotify.np?.isPlaying ? 'is-playing' : ''} ${state?.offline ? 'is-offline' : ''}`}
          aria-label="Spotify"
        >
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
                    <span className="np-state">{state?.label}</span>
                    {spotify.np.isPlaying && spotify.np.device && <DeviceTag device={spotify.np.device} />}
                  </span>
                  <span className="np-title">{spotify.np.title}</span>
                  <span className="np-artist">{spotify.np.artist}</span>
                  {!state?.offline && <NpProgress np={spotify.np} syncedAt={spotify.syncedAt} />}
                </span>
                <span className="np-eq" aria-hidden="true"><i /><i /><i /><i /></span>
              </a>
            ) : !spotify.loaded ? (
              <div className="np is-loading" aria-busy="true">
                <span className="np-art" aria-hidden="true" />
                <span className="np-body">
                  <span className="np-label">spotify</span>
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
                        <span className="r-text">{t.title} <span className="r-artist">— {t.artist}</span></span>
                      </a>
                    ) : (
                      <span>
                        <span className="r-dot">♪</span>
                        <span className="r-text">{t.title} <span className="r-artist">— {t.artist}</span></span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

        <footer className="foot">
          <span className="clock" title="моё время (Самара, UTC+4)">
            {clock} <span className="clock-tz">Samara</span>
          </span>
          <span className="foot-right">
            {views != null && <span className="views" title="просмотры">👁 {views.toLocaleString('ru-RU')}</span>}
            <button
              type="button"
              className={`sound-toggle ${listening ? 'on' : ''}`}
              onClick={() => setListening((v) => !v)}
              disabled={!spotify.np?.uri}
              aria-pressed={listening}
              aria-label={listening ? 'выключить музыку' : 'слушать вместе'}
              title={listening ? 'выключить музыку' : 'слушать вместе'}
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
  )
}
