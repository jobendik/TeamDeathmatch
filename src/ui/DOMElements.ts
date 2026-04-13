/**
 * Centralized DOM element references.
 * All getElementById calls are collected here for maintainability.
 */

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`DOM element #${id} not found`);
  return el as T;
}

export const dom = {
  get cw() { return getEl<HTMLDivElement>('cw'); },
  get hpFill() { return getEl<HTMLDivElement>('hpFill'); },
  get hpTxt() { return getEl<HTMLDivElement>('hpTxt'); },
  get ammoTxt() { return getEl<HTMLDivElement>('ammoTxt'); },
  get ammoMax() { return getEl<HTMLDivElement>('ammoMax'); },
  get weaponName() { return getEl<HTMLDivElement>('weaponName'); },
  get grenadeTxt() { return getEl<HTMLDivElement>('grenadeTxt'); },
  get killTxt() { return getEl<HTMLDivElement>('killTxt'); },
  get deathTxt() { return getEl<HTMLDivElement>('deathTxt'); },
  get dmg() { return getEl<HTMLDivElement>('dmg'); },
  get hlf() { return getEl<HTMLDivElement>('hlf'); },
  get kn() { return getEl<HTMLDivElement>('kn'); },
  get ds() { return getEl<HTMLDivElement>('ds'); },
  get dsp() { return getEl<HTMLParagraphElement>('dsp'); },
  get lockHint() { return getEl<HTMLDivElement>('lockHint'); },
  get sbBlue() { return getEl<HTMLDivElement>('sbBlue'); },
  get sbRed() { return getEl<HTMLDivElement>('sbRed'); },
  get killfeed() { return getEl<HTMLDivElement>('killfeed'); },
  get reloadBar() { return getEl<HTMLDivElement>('reloadBar'); },
  get reloadFill() { return getEl<HTMLDivElement>('reloadFill'); },
  get reloadText() { return getEl<HTMLDivElement>('reloadText'); },
  get mmCanvas() { return getEl<HTMLCanvasElement>('mmCanvas'); },
  get tabboard() { return getEl<HTMLDivElement>('tabboard'); },
  get tbBody() { return getEl<HTMLDivElement>('tbBody'); },
  get roundSummary() { return getEl<HTMLDivElement>('roundSummary'); },
  get rsResult() { return getEl<HTMLDivElement>('rsResult'); },
  get rsTeamScore() { return getEl<HTMLDivElement>('rsTeamScore'); },
  get rsMvp() { return getEl<HTMLDivElement>('rsMvp'); },
  get rsPodium() { return getEl<HTMLDivElement>('rsPodium'); },
  get rsStats() { return getEl<HTMLDivElement>('rsStats'); },
  get rsBtn() { return getEl<HTMLButtonElement>('rsBtn'); },
};
