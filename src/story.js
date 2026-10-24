/**
 * Scroll-driven story: the page is a tall scroll spacer, the canvas is fixed, and
 * the scroll position maps to a timeline of chapters. Each chapter is a keyframe
 * (journey along the route, day/night, dolly position, sim strength); values are
 * interpolated between chapters. Captions fade in near each chapter.
 */
import * as THREE from "three";

export const CHAPTERS = [
  { title: "01 — FLUSHING AV", sub: "board the J at the Williamsburg end", journey: 0.06, dayNight: 0, ride: 0.12, force: 2.5 },
  { title: "02 — BROADWAY EL", sub: "east over Broadway, Bushwick on both sides", journey: 0.42, dayNight: 0, ride: 0.3, force: 2.5 },
  { title: "03 — MYRTLE AV", sub: "the central stop: Checkers, Dunkin', Popeyes below", journey: 0.5, dayNight: 0.5, ride: 0.5, force: 3.5 },
  { title: "04 — DAYBREAK", sub: "same car, same street, first light", journey: 0.72, dayNight: 1, ride: 0.7, force: 2.5 },
  { title: "05 — KOSCIUSZKO ST", sub: "end of the line", journey: 1.0, dayNight: 0.85, ride: 0.88, force: 2.0 },
];

/**
 * @param {{ chapters?: typeof CHAPTERS, container?: HTMLElement, captions?: boolean }} o
 */
export function createStory(o = {}) {
  const chapters = o.chapters ?? CHAPTERS;
  const container = o.container ?? document.body;
  const n = chapters.length;

  const spacer = document.createElement("div");
  spacer.id = "story-spacer";
  spacer.style.height = `${n * 100}vh`;
  container.appendChild(spacer);

  const caption = document.createElement("div");
  caption.id = "story-caption";
  caption.innerHTML = `<div class="story-title"></div><div class="story-sub"></div>`;
  container.appendChild(caption);
  const titleEl = caption.querySelector(".story-title");
  const subEl = caption.querySelector(".story-sub");

  const hint = document.createElement("div");
  hint.id = "story-hint";
  hint.textContent = "scroll to ride · move the pointer to look · drag to push · H for controls";
  container.appendChild(hint);

  let enabled = o.enabled ?? true;
  let shownChapter = -1;
  const state = { t: 0, chapter: 0, local: 0, journey: 0, dayNight: 0, ride: 0, force: 0 };

  function progress() {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    return THREE.MathUtils.clamp(window.scrollY / max, 0, 1) * (n - 1);
  }

  return {
    chapters,
    state,
    get enabled() {
      return enabled;
    },
    setEnabled(v) {
      enabled = v;
      spacer.style.display = v ? "block" : "none";
      caption.style.display = v ? "block" : "none";
      hint.style.display = v ? "block" : "none";
      document.documentElement.style.overflowY = v ? "auto" : "hidden";
    },
    /** Sample the timeline at the current scroll position. */
    update() {
      if (!enabled) return state;
      const t = progress();
      const i = Math.min(n - 2, Math.floor(t));
      const f = THREE.MathUtils.smoothstep(t - i, 0, 1);
      const a = chapters[i], b = chapters[i + 1];
      state.t = t;
      state.chapter = Math.round(t);
      state.local = t - i;
      for (const k of ["journey", "dayNight", "ride", "force"]) state[k] = THREE.MathUtils.lerp(a[k], b[k], f);
      // caption: strongest at integer t, gone halfway between chapters
      const near = 1 - Math.min(1, Math.abs(t - Math.round(t)) * 2.5);
      caption.style.opacity = String(near);
      if (state.chapter !== shownChapter) {
        shownChapter = state.chapter;
        titleEl.textContent = chapters[shownChapter].title;
        subEl.textContent = chapters[shownChapter].sub;
      }
      hint.style.opacity = window.scrollY < 40 ? "1" : "0";
      return state;
    },
  };
}
