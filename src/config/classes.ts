/** Configuration for each bot class */
export interface ClassConfig {
  maxSpeed: number;
  hp: number;
  damage: number;
  fireRate: number;
  burstSize: number;
  burstDelay: number;
  reloadTime: number;
  magSize: number;
  aimError: number;
  reactionTime: number;
  visionRange: number;
  visionFOV: number;
  aggressiveness: number;
  retreatThreshold: number;
  flankPreference: number;
}

export type BotClass = 'rifleman' | 'assault' | 'sniper' | 'flanker';

export const CLASS_CONFIGS: Record<BotClass, ClassConfig> = {
  rifleman: {
    maxSpeed: 5.2, hp: 100, damage: 12, fireRate: 0.28,
    burstSize: 3, burstDelay: 0.08, reloadTime: 2.0, magSize: 30,
    aimError: 0.04, reactionTime: 0.35, visionRange: 32, visionFOV: Math.PI * 0.9,
    aggressiveness: 0.5, retreatThreshold: 25, flankPreference: 0.15,
  },
  assault: {
    maxSpeed: 6.0, hp: 110, damage: 14, fireRate: 0.22,
    burstSize: 4, burstDelay: 0.06, reloadTime: 1.8, magSize: 25,
    aimError: 0.06, reactionTime: 0.25, visionRange: 28, visionFOV: Math.PI * 1.0,
    aggressiveness: 0.8, retreatThreshold: 18, flankPreference: 0.1,
  },
  sniper: {
    maxSpeed: 4.0, hp: 80, damage: 38, fireRate: 0.0,
    burstSize: 1, burstDelay: 0.0, reloadTime: 2.5, magSize: 8,
    aimError: 0.015, reactionTime: 0.5, visionRange: 55, visionFOV: Math.PI * 0.6,
    aggressiveness: 0.3, retreatThreshold: 30, flankPreference: 0.05,
  },
  flanker: {
    maxSpeed: 6.5, hp: 85, damage: 10, fireRate: 0.2,
    burstSize: 3, burstDelay: 0.07, reloadTime: 1.5, magSize: 28,
    aimError: 0.055, reactionTime: 0.3, visionRange: 30, visionFOV: Math.PI * 0.85,
    aggressiveness: 0.6, retreatThreshold: 22, flankPreference: 0.7,
  },
};
