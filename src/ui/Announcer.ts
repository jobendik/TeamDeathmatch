import { dom } from './DOMElements';
import { gameState } from '@/core/GameState';

export type AnnouncementTier = 'small' | 'medium' | 'large' | 'epic';

interface Announcement {
  text: string;
  sub?: string;
  tier: AnnouncementTier;
  color: string;
  duration: number;
}

const queue: Announcement[] = [];
let current: Announcement | null = null;
let timer = 0;
let el: HTMLDivElement | null = null;

function ensureEl(): HTMLDivElement {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'announcer';
  el.innerHTML = `
    <div class="anc-text" id="ancText"></div>
    <div class="anc-sub" id="ancSub"></div>
    <div class="anc-glow" id="ancGlow"></div>
  `;
  document.body.appendChild(el);
  return el;
}

export function announce(text: string, opts: Partial<Omit<Announcement, 'text'>> = {}): void {
  queue.push({
    text: text.toUpperCase(),
    sub: opts.sub,
    tier: opts.tier ?? 'medium',
    color: opts.color ?? '#ffcc33',
    duration: opts.duration ?? 2.0,
  });
}

const TIER_CLASS: Record<AnnouncementTier, string> = {
  small: 'anc-small',
  medium: 'anc-medium',
  large: 'anc-large',
  epic: 'anc-epic',
};

export function updateAnnouncer(dt: number): void {
  const root = ensureEl();
  if (current) {
    timer -= dt;
    if (timer <= 0) {
      root.classList.remove('on');
      current = null;
      timer = 0.25; // brief gap
      return;
    }
  } else if (timer > 0) {
    timer -= dt;
    return;
  } else if (queue.length > 0) {
    current = queue.shift()!;
    timer = current.duration;

    const textEl = document.getElementById('ancText')!;
    const subEl = document.getElementById('ancSub')!;
    const glowEl = document.getElementById('ancGlow')!;

    textEl.textContent = current.text;
    subEl.textContent = current.sub ?? '';
    subEl.style.display = current.sub ? 'block' : 'none';

    root.className = '';
    root.id = 'announcer';
    root.classList.add(TIER_CLASS[current.tier], 'on');
    textEl.style.color = current.color;
    textEl.style.textShadow = `0 0 24px ${current.color}, 0 0 48px ${current.color}, 0 2px 6px rgba(0,0,0,0.9)`;
    glowEl.style.background = `radial-gradient(ellipse at center, ${current.color}22 0%, transparent 60%)`;
  }
}

export function clearAnnouncer(): void {
  queue.length = 0;
  current = null;
  timer = 0;
  if (el) el.classList.remove('on');
}