import { gameState } from '@/core/GameState';
import { ARENA_HALF, TEAM_BLUE } from '@/config/constants';
import { dom } from './DOMElements';
import { canSee } from '@/ai/Perception';

/**
 * Draw the minimap each frame.
 */
export function drawMinimap(): void {
  const canvas = dom.mmCanvas;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  const { arenaColliders, agents, player, cameraYaw } = gameState;

  ctx.fillStyle = 'rgba(3,11,24,.9)';
  ctx.fillRect(0, 0, w, h);

  const scale = w / (ARENA_HALF * 2 + 10);
  const cx = w / 2;
  const cy = h / 2;
  const toX = (x: number) => cx + x * scale;
  const toY = (z: number) => cy + z * scale;

  // Walls
  ctx.fillStyle = 'rgba(30,68,128,.35)';
  for (const c of arenaColliders) {
    if (c.type === 'box') {
      ctx.fillRect(toX(c.x - c.hw), toY(c.z - c.hd), c.hw * 2 * scale, c.hd * 2 * scale);
    } else {
      ctx.beginPath();
      ctx.arc(toX(c.x), toY(c.z), c.r * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Agents
  for (const ag of agents) {
    if (ag.isDead) continue;
    const x = toX(ag.position.x);
    const y = toY(ag.position.z);

    if (ag === player) {
      // Player triangle with glow
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-cameraYaw);
      ctx.shadowBlur = 6;
      ctx.shadowColor = '#38bdf8';
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(-3, 4);
      ctx.lineTo(3, 4);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    } else {
      const isAlly = ag.team === TEAM_BLUE;
      const col = isAlly ? '#38bdf8' : '#ef4444';
      // Only show enemies if spotted by friendly team
      if (!isAlly) {
        const spotted = agents.some((a) => a.team === TEAM_BLUE && !a.isDead && canSee(a, ag));
        if (!spotted) continue;
      }

      // Show combat state — shooting agents pulse
      const inCombat = ag.stateName === 'ENGAGE' || ag.stateName === 'TEAM_PUSH';
      const radius = inCombat ? 3 + Math.sin(gameState.worldElapsed * 10) * 0.8 : 2.5;

      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Show facing direction for allies
      if (isAlly) {
        const heading = Math.atan2(
          Math.sin(ag.rotation.y ?? 0),
          Math.cos(ag.rotation.y ?? 0),
        );
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.sin(heading) * 5, y + Math.cos(heading) * 5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  // Border
  ctx.strokeStyle = 'rgba(56,189,248,.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);
}
