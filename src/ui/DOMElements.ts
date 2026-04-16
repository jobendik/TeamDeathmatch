function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`DOM element #${id} not found`);
  return el as T;
}

function maybeEl<T extends HTMLElement>(id: string): T | null {
  return (document.getElementById(id) as T | null) ?? null;
}

/** Lookup for SVG elements (which don't extend HTMLElement). */
function maybeSvg<T extends SVGElement>(id: string): T | null {
  return (document.getElementById(id) as unknown as T | null) ?? null;
}

export const dom = {
  get cw() { return getEl<HTMLDivElement>('cw'); },

  // Health / armor
  get hpFill() { return getEl<HTMLDivElement>('hpFill'); },
  get hpTxt() { return getEl<HTMLDivElement>('hpTxt'); },
  get armorFill() { return maybeEl<HTMLDivElement>('armorFill'); },
  get armorTxt() { return maybeEl<HTMLDivElement>('armorTxt'); },

  // Ammo / weapon card
  get ammoTxt() { return getEl<HTMLDivElement>('ammoTxt'); },
  get ammoMax() { return getEl<HTMLDivElement>('ammoMax'); },
  get weaponName() { return getEl<HTMLDivElement>('weaponName'); },
  get wcIcon() { return maybeEl<HTMLDivElement>('wcIcon'); },
  get wcMode() { return maybeEl<HTMLDivElement>('wcMode'); },
  get wcReloadHint() { return maybeEl<HTMLDivElement>('wcReloadHint'); },

  // Grenades / Kills / Deaths
  get grenadeTxt() { return getEl<HTMLDivElement>('grenadeTxt'); },
  get killTxt() { return maybeEl<HTMLDivElement>('killTxt'); },
  get deathTxt() { return maybeEl<HTMLDivElement>('deathTxt'); },

  // Weapon slots
  get slot0() { return maybeEl<HTMLDivElement>('slot0'); },
  get slot1() { return maybeEl<HTMLDivElement>('slot1'); },
  get slot2() { return maybeEl<HTMLDivElement>('slot2'); },
  get slot0icon() { return maybeEl<HTMLDivElement>('slot0icon'); },
  get slot1icon() { return maybeEl<HTMLDivElement>('slot1icon'); },
  get slot2icon() { return maybeEl<HTMLDivElement>('slot2icon'); },
  get slot0name() { return maybeEl<HTMLDivElement>('slot0name'); },
  get slot1name() { return maybeEl<HTMLDivElement>('slot1name'); },
  get slot2name() { return maybeEl<HTMLDivElement>('slot2name'); },

  // Overlays
  get dmg() { return getEl<HTMLDivElement>('dmg'); },
  get hlf() { return getEl<HTMLDivElement>('hlf'); },
  get kn() { return getEl<HTMLDivElement>('kn'); },
  get ds() { return getEl<HTMLDivElement>('ds'); },
  get dsp() { return getEl<HTMLParagraphElement>('dsp'); },
  get dsKiller() { return maybeEl<HTMLDivElement>('dsKiller'); },
  get dsWeapon() { return maybeEl<HTMLDivElement>('dsWeapon'); },
  get lockHint() { return getEl<HTMLDivElement>('lockHint'); },

  // Match info
  get miMode() { return maybeEl<HTMLDivElement>('miMode'); },
  get miTime() { return maybeEl<HTMLDivElement>('miTime'); },
  get miScoreBlue() { return maybeEl<HTMLDivElement>('miScoreBlue'); },
  get miScoreRed() { return maybeEl<HTMLDivElement>('miScoreRed'); },

  // Legacy fallbacks — resolve to new match-info panel if old elements aren't present
  get sbBlue() { return maybeEl<HTMLDivElement>('sbBlue') ?? getEl<HTMLDivElement>('miScoreBlue'); },
  get sbRed() { return maybeEl<HTMLDivElement>('sbRed') ?? getEl<HTMLDivElement>('miScoreRed'); },
  get sbMid() { return maybeEl<HTMLDivElement>('sbMid') ?? getEl<HTMLDivElement>('miTime'); },

  // Compass
  get compassStrip() { return maybeEl<HTMLDivElement>('compassStrip'); },

  // Crosshair feedback
  get xhHit() { return maybeEl<HTMLDivElement>('xhHit'); },
  get xhKill() { return maybeEl<HTMLDivElement>('xhKill'); },
  get xhReload() { return maybeEl<HTMLDivElement>('xhReload'); },
  get xhReloadFill() { return maybeSvg<SVGCircleElement>('xhReloadFill'); },

  // Damage arcs
  get dmgArcs() { return maybeEl<HTMLDivElement>('dmgArcs'); },

  // Minimap
  get mmCanvas() { return getEl<HTMLCanvasElement>('mmCanvas'); },
  get mmCoords() { return maybeEl<HTMLDivElement>('mmCoords'); },

  // Menus
  get mainMenu() { return getEl<HTMLDivElement>('mainMenu'); },
  get modeSelect() { return getEl<HTMLSelectElement>('modeSelect'); },
  get startBtn() { return getEl<HTMLButtonElement>('startBtn'); },
  get pauseMenu() { return getEl<HTMLDivElement>('pauseMenu'); },
  get pauseResume() { return getEl<HTMLButtonElement>('pauseResume'); },
  get pauseRestart() { return getEl<HTMLButtonElement>('pauseRestart'); },
  get pauseQuit() { return getEl<HTMLButtonElement>('pauseQuit'); },

  // Killfeed + reload
  get killfeed() { return getEl<HTMLDivElement>('killfeed'); },
  get reloadBar() { return getEl<HTMLDivElement>('reloadBar'); },
  get reloadFill() { return getEl<HTMLDivElement>('reloadFill'); },
  get reloadText() { return getEl<HTMLDivElement>('reloadText'); },

  // Tab scoreboard
  get tabboard() { return getEl<HTMLDivElement>('tabboard'); },
  get tbBody() { return getEl<HTMLDivElement>('tbBody'); },

  // Round summary
  get roundSummary() { return getEl<HTMLDivElement>('roundSummary'); },
  get rsResult() { return getEl<HTMLDivElement>('rsResult'); },
  get rsTeamScore() { return getEl<HTMLDivElement>('rsTeamScore'); },
  get rsMvp() { return getEl<HTMLDivElement>('rsMvp'); },
  get rsPodium() { return getEl<HTMLDivElement>('rsPodium'); },
  get rsStats() { return getEl<HTMLDivElement>('rsStats'); },
  get rsBtn() { return getEl<HTMLButtonElement>('rsBtn'); },
};
