/**
 * DynamicMusic — State-driven music track manager.
 * 
 * Handles switching between Lobby, Start, Mid-match, and Climax tracks
 * based on match state, remaining time, and score.
 */

import { gameState } from '@/core/GameState';
import { Audio } from './AudioManager';
import { isFreeForAll } from '@/core/GameModes';

type MusicState = 'lobby' | 'start' | 'midmatch' | 'climax' | 'none';
let currentState: MusicState = 'none';
let currentTrackId: string | null = null;

const STATE_TRACK_MAP: Record<MusicState, string | null> = {
  lobby: 'music_lobby',
  start: 'music_start',
  midmatch: 'music_midmatch',
  climax: 'music_climax',
  none: null
};

let started = false;

export function startDynamicMusic(): void {
  if (started) return;
  if (!Audio.ctx) Audio.init();
  started = true;
  // Let update logic decide the initial state (usually will be start or midmatch)
}

export function playMusicState(newState: MusicState): void {
  if (newState === currentState) return;
  
  if (currentTrackId) {
    Audio.stopLoop(currentTrackId);
  }
  
  const trackToPlay = STATE_TRACK_MAP[newState];
  if (trackToPlay && Audio.ctx) {
    Audio.loop(trackToPlay);
  }
  
  currentState = newState;
  currentTrackId = trackToPlay;
}

export function updateDynamicMusic(dt: number): void {
  if (!started) return;

  if (gameState.mainMenuOpen || gameState.roundOver) {
    // If the game loop is still running but match is over, we don't swap tracks here.
    return;
  }

  if (gameState.warmupTimer > 0) {
    playMusicState('start');
    return;
  }

  // Calculate if we should play climax music
  let inClimax = false;

  // Time-based climax (less than 60s remaining)
  if (gameState.matchTimeRemaining > 0 && gameState.matchTimeRemaining <= 60) {
    // Only if it's a timed mode with a limit
    inClimax = true;
  }

  // Score-based climax (within 5 points of winning)
  if (!inClimax && gameState.scoreLimit > 0) {
    if (isFreeForAll()) {
      let highestScore = 0;
      for (const ag of gameState.agents) {
        if (ag.kills > highestScore) highestScore = ag.kills;
      }
      if (highestScore >= gameState.scoreLimit - 5) {
        inClimax = true;
      }
    } else {
      const highestTeamScore = Math.max(gameState.teamScores[0], gameState.teamScores[1]);
      if (highestTeamScore >= gameState.scoreLimit - 5) {
        inClimax = true;
      }
    }
  }

  // In BR mode, climax could be triggered by small zone circle or 5 players left.
  if (gameState.mode === 'br') {
    let alive = 0;
    for (const ag of gameState.agents) {
      if (!ag.isDead) alive++;
    }
    if (alive <= 5 && !gameState.pDead) {
      inClimax = true;
    }
  }

  if (inClimax) {
    playMusicState('climax');
  } else {
    playMusicState('midmatch');
  }
}

export function stopDynamicMusic(): void {
  playMusicState('none');
  started = false;
}
