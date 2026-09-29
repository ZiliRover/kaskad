"use client";

import { ImageIcon, SparkleIcon, StorefrontIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { ART_SETS, ART_VIDEOS, artPhoto, artSlide } from "@/config/art";

const PHRASES = ["комплект карточек для WB", "ролик для Reels", "живое видео", "серия в одном стиле"];
const MODELS = ["Seedance 2.0", "Kling 3.0", "GPT Image 2", "FLUX.2", "Wan 3.0", "Hailuo 3", "Sora 2 Pro", "Recraft 4", "MiniMax Speech", "Whisper"];
/** one product through the pipeline, then the next */
const CYCLE_MS = 5200;

type Tile = { kind: "image"; src: string } | { kind: "video"; src: string; poster: string };

/** Slides of every set, spread over columns so neighbours differ; a video now and then. */
function wallColumns(count: number): Tile[][] {
  const slides: Tile[] = ART_SETS.flatMap((s) => s.best.map((n) => ({ kind: "image" as const, src: artSlide(s.id, n) })));
  // interleave the sets: slide 1 of every set, then slide 2 of every set…
  const mixed: Tile[] = [];
  for (let k = 0; k < 4; k++) for (let i = 0; i < ART_SETS.length; i++) mixed.push(slides[i * 4 + k]);
  const cols: Tile[][] = Array.from({ length: count }, () => []);
  mixed.forEach((t, i) => cols[i % count].push(t));
  ART_VIDEOS.forEach((v, i) => cols[(i * 2 + 1) % count].splice(2 + i * 3, 0, { kind: "video", ...v }));
  return cols;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * The left side of the sign-in page: what the studio makes, shown with its own work.
 * A slow wall of real results, a product going through a live cascade, the models.
 */
export function AuthStage() {
  const reduced = useReducedMotion();
  const [cycle, setCycle] = useState(0);
  const [phrase, setPhrase] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const a = setInterval(() => setCycle((c) => c + 1), CYCLE_MS);
    const b = setInterval(() => setPhrase((p) => p + 1), 2600);
    return () => { clearInterval(a); clearInterval(b); };
  }, [reduced]);

  const set = ART_SETS[cycle % ART_SETS.length];
  const cols = wallColumns(4);

  return (
    <section className={`stage${reduced ? " is-still" : ""}`} aria-label="Что делает Каскад">
      <div className="stage-wall" aria-hidden>
        {cols.map((col, i) => (
          <div key={i} className="stage-col" style={{ ["--dur" as string]: `${70 + i * 14}s`, ["--dir" as string]: i % 2 ? "reverse" : "normal" }}>
            {/* the column twice, so the loop has no seam */}
            {[...col, ...col].map((t, j) => (
              <div key={j} className="stage-tile">
                {t.kind === "video"
                  ? <video src={t.src} poster={t.poster} muted loop playsInline autoPlay={!reduced} preload="metadata" />
                  // eslint-disable-next-line @next/next/no-img-element
                  : <img src={t.src} alt="" loading={j < 3 ? "eager" : "lazy"} decoding="async" />}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="stage-shade" aria-hidden />

      <div className="stage-copy">
        <p className="stage-over">Нодовая AI-студия · все модели в рублях</p>
        <h2 className="stage-title">
          Одно фото —<br />
          <span className="stage-rotor" aria-live="off">
            <span key={phrase} className="stage-phrase">{PHRASES[phrase % PHRASES.length]}</span>
          </span>
        </h2>
      </div>

      <div className="cascade" key={cycle} aria-hidden>
        <div className="cascade-node is-in">
          <span className="cascade-head"><ImageIcon size={12} weight="bold" />Фото товара</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="cascade-photo" src={artPhoto(set.id)} alt="" />
          <span className="cascade-cap">{set.name}</span>
        </div>
        <svg className="cascade-wire is-a" viewBox="0 0 100 20" preserveAspectRatio="none">
          <path d="M0 10 C 40 10, 60 10, 100 10" />
          <path className="cascade-pulse" d="M0 10 C 40 10, 60 10, 100 10" />
        </svg>
        <div className="cascade-node is-model">
          <span className="cascade-head"><SparkleIcon size={12} weight="bold" />GPT Image 2</span>
          <span className="cascade-meta">7 слайдов · 3:4</span>
          <span className="cascade-bar"><span /></span>
          <span className="cascade-meta is-done">готово</span>
        </div>
        <svg className="cascade-wire is-b" viewBox="0 0 100 20" preserveAspectRatio="none">
          <path d="M0 10 C 40 10, 60 10, 100 10" />
          <path className="cascade-pulse" d="M0 10 C 40 10, 60 10, 100 10" />
        </svg>
        <div className="cascade-out">
          <span className="cascade-head"><StorefrontIcon size={12} weight="bold" />{set.market} · 900×1200</span>
          <div className="cascade-fan">
            {[0, 1, 2].map((i) => <span key={`g${i}`} className="cascade-ghost" style={{ ["--i" as string]: i }} />)}
            {set.best.slice(0, 3).map((n, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={n} src={artSlide(set.id, n)} alt="" style={{ ["--i" as string]: i }} />
            ))}
          </div>
        </div>
      </div>

      <div className="stage-models" aria-hidden>
        <div className="stage-ticker">
          {[...MODELS, ...MODELS].map((m, i) => <span key={i}>{m}</span>)}
        </div>
      </div>
      <p className="stage-note">Все работы на этой странице сделаны в Каскаде</p>
    </section>
  );
}
