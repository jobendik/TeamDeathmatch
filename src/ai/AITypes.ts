import * as YUKA from 'yuka';
import type { TeamId } from '@/config/constants';

export type SightingSource = 'visual' | 'audio' | 'callout' | 'damage';
export type AimPhase = 'search' | 'acquire' | 'settle' | 'track' | 'panic';
export type PeekSide = 'left' | 'right';
export type TacticalRole = 'anchor' | 'point' | 'trader' | 'support' | 'flanker' | 'lurker' | 'sniper';
export type TeamIntent = 'hold' | 'collapse' | 'flank_left' | 'flank_right' | 'reset' | 'hunt';

export interface EnemyMemory {
  enemyId: string;
  enemyName: string;
  enemyTeam: TeamId;
  lastSeenPos: YUKA.Vector3;
  predictedPos: YUKA.Vector3;
  lastVelocity: YUKA.Vector3;
  certainty: number;          // 0..1
  visibility: number;         // 0..1
  source: SightingSource;
  lastUpdateTime: number;
  uncertaintyRadius: number;
  threat: number;
  wasVisible: boolean;
}

export interface TeamCallout {
  enemyId: string;
  enemyName: string;
  pos: YUKA.Vector3;
  certainty: number;
  createdAt: number;
  source: SightingSource;
}

export interface TeamTacticalBoard {
  team: TeamId;
  intent: TeamIntent;
  lastUpdate: number;
  focusPos: YUKA.Vector3 | null;
  pressure: number;
  knownEnemyCount: number;
  anchorName: string | null;
  traderName: string | null;
}
