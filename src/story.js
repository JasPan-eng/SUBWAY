/**
 * The ride: the page is one tall scroll, the canvas is fixed, and scrolling moves the train
 * along the J line through five stops. Each stop is a keyframe (journey along the route,
 * night/day, dolly position, sim strength) interpolated between stops.
 *
 * Interface, in order of appearance:
 *   - a station sign while the splats load (J bullet, destination, loading bar), which
 *     becomes "scroll to board" when the car is ready: one gesture starts the ride
 *   - a route strip at the bottom: the three stations and a J marker at the train's position
 *   - a station sign caption that fades in at each stop
 * Nothing else. The developer panel stays behind ?gui.
 */
import * as THREE from "three";

export const STOPS = [
  { id: "flushing", sign: "Flushing Av", sub: "boarding · J to Jamaica Center", station: true, journey: 0.06, dayNight: 0, ride: 0.12, force: 1.2 },
  { id: "broadway", sign: "Broadway", sub: "on the el · Bushwick on both sides", station: false, journey: 0.4, dayNight: 0, ride: 0.3, force: 1.6 },
  { id: "myrtle", sign: "Myrtle Av", sub: "Broadway · the centre of the line", station: true, journey: 0.5, dayNight: 0.45, ride: 0.5, force: 2.4 },
  { id: "daybreak", sign: "First light", sub: "same car, same street", station: false, journey: 0.74, dayNight: 1, ride: 0.7, force: 1.4 },
  { id: "kosciuszko", sign: "Kosciuszko St", sub: "end of the line", station: true, journey: 1.0, dayNight: 1.0, ride: 0.78, force: 1.0 },
];

const BULLET = `<span class="j-bullet" aria-hidden="true">J</span>`;

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/**
 * @param {{ stops?: typeof STOPS, container?: HTMLElement, enabled?: boolean }} o
 */
export function createStory(o = {}) {
  const stops = o.stops ?? STOPS;
  const container = o.container ?? document.body;
  const n = stops.length;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- scroll spacer: one viewport per stop
  const spacer = el("div", "", "");
  spacer.id = "ride-spacer";
  spacer.style.height = `${n * 100}vh`;
  container.appendChild(spacer);

  // ---- station sign / loader
  const intro = el("div", "ride-intro", `
    <div class="sign" role="status" aria-live="polite">
      <div class="sign-head">${BULLET}<span class="sign-dest">to Jamaica Center</span></div>
      <div class="sign-next"><span class="label">Next stop</span><span class="sign-stop">Flushing Av</span></div>
      <div class="sign-bar"><div class="sign-fill"></div></div>
      <div class="sign-foot"><span class="sign-state">Loading the car</span><span class="sign-pct">0%</span></div>
    </div>
    <button class="ride-cta" type="button" hidden>Scroll to board</button>
  `);
  intro.id = "ride-intro";
  container.appendChild(intro);
  const fill = intro.querySelector(".sign-fill");
  const stateEl = intro.querySelector(".sign-state");
  const pctEl = intro.querySelector(".sign-pct");
  const cta = intro.querySelector(".ride-cta");

  // ---- route strip
  const strip = el("div", "ride-strip", `<div class="strip-line"></div><div class="strip-marker">${BULLET}</div>`);
  strip.id = "ride-strip";
  for (const s of stops) {
    if (!s.station) continue;
    const dot = el("div", "strip-stop", `<span class="strip-dot"></span><span class="strip-name">${s.sign}</span>`);
    dot.style.left = `${s.journey * 100}%`;
    strip.appendChild(dot);
  }
  const marker = strip.querySelector(".strip-marker");
  container.appendChild(strip);

  // ---- stop caption
  const caption = el("div", "ride-caption", `<div class="cap-sign"></div><div class="cap-sub"></div>`);
  caption.id = "ride-caption";
  container.appendChild(caption);
  const signEl = caption.querySelector(".cap-sign");
  const subEl = caption.querySelector(".cap-sub");

  let enabled = o.enabled ?? true;
  let started = false;
  let ready = false;
  let shownStop = -1;
  const state = { t: 0, stop: 0, local: 0, journey: stops[0].journey, dayNight: stops[0].dayNight, ride: stops[0].ride, force: stops[0].force, started: false };
  const listeners = { start: [] };

  function lockScroll(lock) {
    document.documentElement.style.overflowY = lock ? "hidden" : "auto";
  }

  function start() {
    if (started || !ready) return;
    started = true;
    state.started = true;
    intro.classList.add("is-leaving");
    lockScroll(false);
    window.scrollTo({ top: 0 });
    setTimeout(() => intro.remove(), reduced ? 0 : 420);
    for (const fn of listeners.start) fn();
  }

  // One gesture starts the ride: scroll, tap, key or the button.
  const onFirstGesture = (e) => {
    if (!ready) return;
    if (e.type === "keydown" && !["ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) return;
    start();
    window.removeEventListener("wheel", onFirstGesture);
    window.removeEventListener("touchstart", onFirstGesture);
    window.removeEventListener("keydown", onFirstGesture);
  };
  window.addEventListener("wheel", onFirstGesture, { passive: true });
  window.addEventListener("touchstart", onFirstGesture, { passive: true });
  window.addEventListener("keydown", onFirstGesture);
  cta.addEventListener("click", start);
  intro.addEventListener("click", (e) => {
    if (ready && e.target !== cta) start();
  });

  function progress() {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    return THREE.MathUtils.clamp(window.scrollY / max, 0, 1) * (n - 1);
  }

  function setEnabled(v) {
    enabled = v;
    spacer.style.display = v ? "block" : "none";
    strip.style.display = v ? "block" : "none";
    caption.style.display = v ? "block" : "none";
    intro.style.display = v ? "grid" : "none";
    lockScroll(v && !started);
  }
  setEnabled(enabled);

  return {
    stops,
    state,
    get enabled() {
      return enabled;
    },
    get started() {
      return started;
    },
    setEnabled,
    onStart(fn) {
      listeners.start.push(fn);
    },
    /** Loading feedback on the sign: 0..1 and a short status line. */
    setLoading(frac, text) {
      fill.style.transform = `scaleX(${THREE.MathUtils.clamp(frac, 0, 1)})`;
      pctEl.textContent = `${Math.round(THREE.MathUtils.clamp(frac, 0, 1) * 100)}%`;
      if (text) stateEl.textContent = text;
    },
    /** The car is loaded: turn the sign into the boarding prompt. */
    setReady() {
      ready = true;
      this.setLoading(1, "Doors open");
      cta.hidden = false;
      intro.classList.add("is-ready");
    },
    /** Sample the timeline at the current scroll position. */
    update() {
      if (!enabled) return state;
      const t = started ? progress() : 0;
      const i = Math.min(n - 2, Math.floor(t));
      const f = THREE.MathUtils.smoothstep(t - i, 0, 1);
      const a = stops[i], b = stops[i + 1];
      state.t = t;
      state.stop = Math.round(t);
      state.local = t - i;
      for (const k of ["journey", "dayNight", "ride", "force"]) state[k] = THREE.MathUtils.lerp(a[k], b[k], f);
      marker.style.left = `${state.journey * 100}%`;
      // caption: strongest at a stop, gone halfway between stops; hidden before boarding
      const near = started ? 1 - Math.min(1, Math.abs(t - Math.round(t)) * 2.5) : 0;
      caption.style.opacity = String(near);
      if (state.stop !== shownStop) {
        shownStop = state.stop;
        const s = stops[shownStop];
        signEl.innerHTML = `${s.station ? BULLET : ""}<span>${s.sign}</span>`;
        subEl.textContent = s.sub;
        caption.classList.toggle("is-station", s.station);
      }
      return state;
    },
  };
}
