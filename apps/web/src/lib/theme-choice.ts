/** Remembers (on this computer) that the person chose light or dark themselves, so the clinic's default no longer applies. */
const KEY = 'vcms.theme.chosen';

export function markThemeChosen() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

export function themeChosen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
