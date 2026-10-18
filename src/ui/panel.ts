import { CATALOG, species } from '../data/catalog.ts';
import { BATH_COST, CAPACITY, FILTER_COST, FILTER_POWER, FOOD, GACHA, MILESTONES } from '../data/balance.ts';
import { getCapacity, getCleanliness, getFishStats, getGachaOdds, getIncomePerMinute, isGateOpen } from '../sim/engine.ts';
import type { BagSize, FishState, GameAction, GameEvent, Locale, Mode, SaveV1, SceneFeedback, SpeciesSpec, Tier } from '../sim/types.ts';
import { formatNumber, formatTime, t } from './i18n.ts';

export interface PanelCallbacks {
  onAction(action: GameAction): void; onMode(mode: Mode): void; onLanguage(locale: Locale): void;
  onMute(): void; onExport(): void; onImport(file: File): void; onRestart(): void;
  onDialogChange(open: boolean): void;
  onSheetChange(open: boolean): void;
  onSelectFish(id:string|null):void;
}
export interface Panel {
  sceneHost: HTMLElement;
  update(save: SaveV1, events?: GameEvent[]): void;
  setMode(mode: Mode): void; selectFish(id: string | null, openDetails?: boolean): void; notify(message: string): void;
  setSceneFeedback(feedback: SceneFeedback): void;
  showOffline(summary: { seconds: number; coins: number; adults: number }): void;
  confirm(title: string, body: string): Promise<boolean>; setBlocked(message: string): void;
  reveal(spec: SpeciesSpec): Promise<void>; showRecovery(raw: string, onNew: () => void): void;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}
type SheetView = 'shop' | 'gacha' | 'collection' | 'upgrades' | 'fish' | 'settings';
function icon(name: string): SVGSVGElement {
  const paths: Record<string, string> = {
    coin: '<circle cx="12" cy="12" r="9"/><path d="M15 8h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9m3-10v12"/>',
    food: '<path d="m5 7 3-4h8l3 4-2 14H7ZM5 7h14"/><circle cx="12" cy="14" r="3"/>',
    fish: '<path d="M4 12q7-12 15 0-8 12-15 0Zm0 0-3-4v8Z"/><circle cx="15" cy="11" r=".7"/>',
    water: '<path d="M12 2S4 11 4 15a8 8 0 0 0 16 0c0-4-8-13-8-13ZM7 16q1 4 5 4"/>',
    gear: '<path d="m9 3 1-2h4l1 2 3 2 2 1v4l-2 2v3l2 2-2 3-3-1-3 2-3-2-3 1-2-3 2-2v-3L2 10V6l3-1Z"/><circle cx="12" cy="10" r="3"/>',
    eye: '<path d="M1 12q11-16 22 0-11 16-22 0Z"/><circle cx="12" cy="12" r="4"/>',
    brush: '<path d="m10 14 9-12 3 3-10 11M4 14q8-3 8 4-1 5-10 4 4-2 2-8Z"/>',
    shop: '<path d="M3 9v12h18V9M2 9l3-7h14l3 7q-2 4-5 0-3 4-5 0-3 4-5 0-3 4-5 0ZM9 21v-8h6v8"/>',
    capsule: '<path d="m5 19 14-14M5 5a7 7 0 0 1 10 0l4 4a7 7 0 0 1-10 10l-4-4A7 7 0 0 1 5 5Z"/>',
    cards: '<path d="M5 6h16v16H5ZM2 18V2h16M9 16l3-4 3 3 3-5"/>',
    upgrade: '<path d="m3 11 9-9 9 9h-6v11H9V11Z"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
  };
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24'); node.setAttribute('aria-hidden', 'true');
  node.setAttribute('fill', 'none'); node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '2'); node.setAttribute('stroke-linecap', 'round'); node.setAttribute('stroke-linejoin', 'round');
  node.classList.add('ui-icon'); node.innerHTML = paths[name]!;
  return node;
}

/** Small vector field-guide plates, separate from the single live WebGPU renderer. */
function fishPlate(spec: SpeciesSpec, known: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 160 88');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('fish-plate', `family-${spec.family}`);
  const [body, accent, belly] = known ? spec.colors : ['#a7aaa0', '#888e84', '#c2c5ba'];
  const id = `plate-${spec.id}`;
  const eel = spec.family === 'eel', ray = spec.family === 'ray', shark = spec.family === 'shark';
  const tall = spec.family === 'tall', round = spec.family === 'puffer';
  let shape = `<ellipse cx="77" cy="44" rx="${tall ? 26 : round ? 28 : 39}" ry="${tall ? 33 : round ? 27 : shark ? 15 : 22}"/>`;
  let fins = '<path d="M43 42 17 24 20 64 44 48Z"/>';
  if (shark) {
    shape = '<path d="M29 45Q48 27 107 31Q137 31 141 44Q131 58 102 56Q51 61 29 45Z"/>';
    fins = '<path d="M39 45 12 18 23 47 18 61ZM74 33 90 12 98 34ZM90 49 67 72 107 54Z"/>';
    if (spec.id === 'hammerhead') shape += '<path d="M117 34 134 19 146 23 142 44 147 65 135 69 117 54Z"/>';
    if (spec.id === 'sawfish') shape += '<path d="M129 39 157 39 157 47 129 48Z"/><path d="M137 39v-5m6 5v-5m6 5v-5m-12 13v5m6-5v5m6-5v5" stroke="'+body+'" stroke-width="3"/>';
    if (spec.id === 'thresher-shark') fins = fins.replace('12 18', '2 2');
  } else if (eel) {
    shape = '<path d="M9 67Q43 18 82 42T148 32L148 47Q117 70 79 56T14 75Z"/>';
    fins = '<path d="M11 64Q46 12 84 36T147 25L148 34Q116 54 81 44T11 70Z"/>';
  } else if (ray) {
    shape = '<path d="M34 45 80 9 125 45 80 69Z"/>';
    fins = '<path d="M80 58Q70 81 23 80" fill="none" stroke="'+body+'" stroke-width="4"/>';
    if (spec.id === 'manta') shape += '<path d="M70 23 68 9 75 12 80 25 85 12 92 9 90 28Z"/>';
  } else if (spec.family === 'seahorse') {
    shape = '<path d="M79 15Q98 9 104 23L124 29 121 37 98 33Q88 40 100 49Q115 70 91 78Q68 83 65 68Q68 53 81 62L79 68Q88 74 94 65Q95 57 81 50Q63 39 79 15Z"/>';
    fins = '<path d="M79 30 63 29 64 46 80 44Z"/>';
  } else if (spec.family === 'flowing') {
    fins = '<path d="M47 37Q8 1 10 42Q-1 79 47 54ZM58 30Q88 1 111 32ZM53 54Q89 91 117 55Z"/>';
  } else if (spec.family === 'lionfish') {
    fins = '<path d="M42 40 10 13 33 45 6 46 37 50 13 80 48 56ZM53 32 50 3 65 28 72 0 79 24 93 2 96 28 119 7 110 36Z"/>';
  } else if (spec.id === 'swordtail') fins += '<path d="M43 50 6 83 23 53Z"/>';
  else if (spec.id === 'sunfish') fins = '<path d="M63 21 89 0 94 24ZM63 66 87 87 92 63Z"/><path d="M49 27 39 35 44 44 39 52 50 63Z"/>';
  else if (tall) fins += '<path d="M58 29 77 2 98 29ZM59 59 77 86 97 58Z"/>';
  const striped = ['zebra-danio','angelfish','clownfish','copperband','moorish-idol','emperor-angelfish','blue-cichlid','dwarf-gourami','lionfish'].includes(spec.id);
  const spots = ['molly','puffer','stingray','zebra-shark','leopard-shark','whale-shark','koi','blue-gourami'].includes(spec.id);
  let marks = '';
  if (striped) for (let i = 0; i < 6; i++) marks += `<path d="M${43 + i * 14} 8l-13 70" stroke="${accent}" stroke-width="${spec.id === 'emperor-angelfish' ? 3 : 7}"/>`;
  if (spots) for (let i = 0; i < 16; i++) marks += `<ellipse cx="${38 + (i * 19) % 94}" cy="${25 + (i * 13) % 37}" rx="${spec.id === 'koi' ? 10 : 2.7}" ry="${spec.id === 'koi' ? 8 : 2}" fill="${accent}"/>`;
  if (['neon-tetra','white-cloud','mandarin','discus'].includes(spec.id)) marks += `<path d="M35 43Q80 26 121 43M41 51Q83 37 119 50" stroke="${accent}" stroke-width="5" fill="none"/>`;
  if (['royal-gramma','rainbowfish'].includes(spec.id)) marks += `<path d="M0 0H76V88H0Z" fill="${accent}"/>`;
  if (spec.id === 'blue-tang') marks += `<path d="M44 34Q89 26 111 38L76 44 62 57 45 49Z" fill="${accent}"/>`;
  if (spec.id === 'blacktip-shark') fins += '<path d="M84 22 90 12 94 23ZM74 65 67 72 83 65Z" fill="'+accent+'"/>';
  svg.innerHTML = `<defs><clipPath id="${id}">${shape}</clipPath></defs><g fill="${accent}">${fins}</g><g fill="${body}">${shape}</g><g clip-path="url(#${id})"><ellipse cx="83" cy="61" rx="51" ry="14" fill="${belly}" opacity=".8"/>${known ? marks : ''}</g><circle cx="${spec.family === 'seahorse' ? 99 : ray ? 89 : 112}" cy="${spec.family === 'seahorse' ? 24 : 39}" r="2.5" fill="#253c3c"/><circle cx="${spec.family === 'seahorse' ? 99.7 : ray ? 89.7 : 112.7}" cy="${spec.family === 'seahorse' ? 23.3 : 38.3}" r=".8" fill="#fff"/>`;
  return svg;
}

export function createPanel(root: HTMLElement, callbacks: PanelCallbacks): Panel {
  let save: SaveV1 | null = null, locale: Locale = 'vi', mode: Mode = 'inspect';
  let tab: SheetView = 'shop', activeSheet: SheetView | null = null, sheetOpener: HTMLElement | null = null;
  let selectedId: string | null = null, blocked = false, revealing = false, lastRoster = 0;
  let rosterSignature = '', shopSignature = '', gachaSignature = '', collectionSignature = '', upgradeSignature = '';
  let offlineDialog: HTMLDialogElement | null = null;
  let offlineTotals = { seconds: 0, coins: 0, adults: 0 };
  let modalDepth = 0, remainingFood = 0;
  const dismissDialogs = new Set<() => void>();
  let lastFinished: {count:number;remaining:number} | null = null;
  let sceneFeedback: SceneFeedback = { hoveredFishId: null, target: 'none', feeding: false, dropped: 0 };
  const localizers: (() => void)[] = [], guarded: { node: HTMLButtonElement | HTMLInputElement; unavailable: () => boolean }[] = [];
  const buttonLabels = new WeakMap<HTMLButtonElement, HTMLSpanElement>();
  function setButtonText(node: HTMLButtonElement, value: string): void { buttonLabels.get(node)!.textContent = value; }
  const text = (key: string, params: Record<string, string | number> = {}) => t(locale, key, params);
  const num = (value: number) => formatNumber(locale, value);
  function label<K extends keyof HTMLElementTagNameMap>(tag: K, key: string, className = ''): HTMLElementTagNameMap[K] {
    const node = element(tag, className);
    localizers.push(() => { node.textContent = text(key); });
    node.textContent = text(key);
    return node;
  }
  function button(key: string, handler: () => void, className = 'button', allowBlocked = false): HTMLButtonElement {
    const node = element('button', className), caption = label('span', key, 'button-label');
    node.append(caption); buttonLabels.set(node, caption);
    node.type = 'button';
    node.addEventListener('click', () => { if (!blocked || allowBlocked) handler(); });
    if (!allowBlocked) guarded.push({ node, unavailable: () => false });
    return node;
  }
  function actionButton(key: string, action: GameAction, unavailable: () => boolean, className = 'button primary'): HTMLButtonElement {
    const node = button(key, () => { if (save && !unavailable()) callbacks.onAction(action); }, className);
    guarded[guarded.length - 1]!.unavailable = unavailable;
    return node;
  }
  function refreshControls(): void {
    for (const { node, unavailable } of guarded) node.disabled = blocked || !save || unavailable();
  }
  root.replaceChildren();
  root.classList.add('aquarium-app');
  const header = element('header', 'app-header');
  const brand = label('h1', 'title', 'brand');
  const resourceValues: Record<string, HTMLElement> = {};
  const wallet = element('div', 'wallet-pill'), walletValue = element('strong');
  wallet.append(icon('coin'), label('span', 'wallet', 'sr-only'), walletValue); resourceValues.wallet = walletValue;
  const gear = button('settings', () => openSheet('settings'), 'button settings-button'); gear.prepend(icon('gear'));
  header.append(brand, wallet, gear);
  const controls = element('section', 'settings-controls');
  const language = element('select', 'language-select');
  for (const [value, title] of [['vi', 'Tiếng Việt'], ['en', 'English']]) { const opt = element('option', '', title); opt.value = value!; language.append(opt); }
  language.addEventListener('change', () => { const value = language.value as Locale; callbacks.onLanguage(value); if (locale !== value) localize(value); });
  const mute = button('soundOff', callbacks.onMute, 'button subtle');
  const exportButton = button('export', callbacks.onExport, 'button subtle', true);
  const importInput = element('input'); importInput.type = 'file'; importInput.accept = '.json,application/json'; importInput.hidden = true;
  importInput.addEventListener('change', () => { const file = importInput.files?.[0]; if (file && !blocked) callbacks.onImport(file); importInput.value = ''; });
  const importButton = button('import', () => importInput.click(), 'button subtle');
  const help = button('help', () => { void dialog(() => text('helpTitle'), () => text('helpBody'), false).result; }, 'button subtle');
  controls.append(language, mute, exportButton, importButton, help, importInput);
  const resources = element('section', 'resources');
  for (const [key, glyph] of [['food', 'food'], ['fish', 'fish'], ['cleanliness', 'water']]) {
    const item = element('div', `resource resource-${key}`), value = element('strong');
    item.append(icon(glyph!), label('span', key!, 'sr-only'), value); resources.append(item); resourceValues[key!] = value;
  }
  const banner = element('section', 'blocking-banner'); banner.hidden = true; banner.setAttribute('role', 'alert');
  const bannerMessage = element('p');
  banner.append(bannerMessage, button('export', callbacks.onExport, 'button', true), button('reload', () => window.location.reload(), 'button primary', true));
  const warnings = element('div', 'care-warnings'); warnings.setAttribute('aria-live', 'polite'); warnings.setAttribute('role', 'status');
  const layout = element('main', 'game-layout');
  const sceneHost = element('div', 'scene-host');
  sceneHost.setAttribute('aria-label', text('title')); sceneHost.setAttribute('role', 'region');
  const dock = element('section', 'action-dock');
  const sceneHint = element('p', 'scene-hint');
  const sceneControl = element('span'), sceneProgress = element('span', 'feed-progress');
  const sceneStatus = element('span', 'sr-only');
  sceneStatus.setAttribute('role', 'status'); sceneStatus.setAttribute('aria-live', 'polite'); sceneStatus.setAttribute('aria-atomic', 'true');
  sceneHint.append(sceneControl, sceneProgress, sceneStatus);
  const toolbar = element('div', 'mode-toolbar'); toolbar.setAttribute('role', 'toolbar');
  const modeButtons: Partial<Record<Mode, HTMLButtonElement>> = {};
  for (const [value, glyph] of [['inspect', 'eye'], ['feed', 'food'], ['scrub', 'brush']] as const) {
    const node = button(value, () => { setMode(value); callbacks.onMode(value); }, 'mode-button');
    node.prepend(icon(glyph)); modeButtons[value] = node; toolbar.append(node);
  }
  const collect = actionButton('collect', { type: 'collect-all' }, () => !save || save.run.pendingCoins === 0, 'button collect-button');
  collect.prepend(icon('coin')); dock.append(sceneHint, toolbar, collect); layout.append(sceneHost);
  const navigation = element('nav', 'game-navigation');
  const launchers: Partial<Record<SheetView, HTMLButtonElement>> = { settings: gear };
  const names = ['shop', 'gacha', 'collection', 'upgrades', 'fish'] as const;
  const navKeys = { shop: 'shop', gacha: 'gacha', collection: 'nav-collection', upgrades: 'upgrades', fish: 'nav-fish', settings: 'settings' };
  const glyphs = { shop: 'shop', gacha: 'capsule', collection: 'cards', upgrades: 'upgrade', fish: 'fish' };
  for (const name of names) {
    const node = button(navKeys[name], () => openSheet(name), 'nav-button');
    node.prepend(icon(glyphs[name])); navigation.append(node); launchers[name] = node;
  }
  for (const node of Object.values(launchers)) {
    node.setAttribute('aria-haspopup', 'dialog'); node.setAttribute('aria-controls', 'management-sheet'); node.setAttribute('aria-expanded', 'false');
  }
  const sheet = element('dialog', 'game-sheet'); sheet.id = 'management-sheet';
  const sheetHeader = element('header', 'sheet-header'), sheetTitle = element('h2'); sheetTitle.id = 'sheet-title';
  sheet.setAttribute('aria-labelledby', sheetTitle.id);
  const sheetClose = button('close', closeSheet, 'button sheet-close', true); sheetClose.prepend(icon('close'));
  sheetHeader.append(sheetTitle, sheetClose);
  const tabs = element('div', 'tabs'); tabs.setAttribute('role', 'tablist');
  const panes: Record<string, HTMLElement> = {}, tabButtons: Record<string, HTMLButtonElement> = {};
  for (const name of names) {
    const node = button(navKeys[name], () => openSheet(name), 'tab-button');
    node.id = `tab-${name}`; node.setAttribute('role', 'tab'); node.setAttribute('aria-controls', `pane-${name}`);
    tabs.append(node); tabButtons[name] = node;
    const pane = element('section', 'tab-pane'); pane.id = `pane-${name}`; pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', node.id); panes[name] = pane;
  }
  panes.settings = element('section', 'tab-pane'); panes.settings.append(label('h3', 'settings'), controls);
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = names.indexOf(tab as typeof names[number]);
    const next = names[event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length]!;
    openSheet(next); tabButtons[next]!.focus();
  });
  const tabContent = element('div', 'sheet-body'); tabContent.append(...Object.values(panes));
  const selected = element('section', 'selected-fish'), selectedHeading = label('h2', 'selected', 'section-kicker'), selectedContent = element('div');
  selected.append(selectedHeading, selectedContent);
  const rosterDescription = label('p', 'rosterIntro', 'muted'), sortLabel = label('label', 'sort', 'sort-label'); sortLabel.htmlFor = 'fish-sort';
  const sort = element('select', 'roster-sort'); sort.id = 'fish-sort';
  for (const [value, key] of [['id','sortId'], ['name','sortName'], ['hunger','sortHunger'], ['growth','sortGrowth'], ['income','sortIncome'], ['sale','sortSale']]) {
    const option = label('option', key!); option.value = value!; sort.append(option);
  }
  sort.addEventListener('change', () => { rosterSignature = ''; renderFish(true); });
  const rosterList = element('div', 'roster-list');
  panes.fish!.append(selected, rosterDescription, sortLabel, sort, rosterList);
  sheet.append(sheetHeader, tabs, tabContent);
  sheet.addEventListener('cancel', event => { event.preventDefault(); closeSheet(); });
  sheet.addEventListener('close', closeSheet);
  let backdropDown = false;
  const outside = (event: PointerEvent) => { const rect = sheet.getBoundingClientRect(); return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom; };
  sheet.addEventListener('pointerdown', event => { backdropDown = event.target === sheet && outside(event); });
  sheet.addEventListener('pointerup', event => { if (backdropDown && event.target === sheet && outside(event)) closeSheet(); backdropDown = false; });
  sheet.addEventListener('pointercancel', () => { backdropDown = false; });
  const toast = element('div', 'toast'); toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); toast.hidden = true;
  let toastTimer = 0;
  const recovery = element('section', 'recovery'); recovery.hidden = true;
  root.append(header, resources, banner, warnings, layout, dock, navigation, recovery, toast, sheet);

  // Construct static tab cards once. Dynamic counters and transaction guards are updated separately.
  panes.shop!.append(label('h2', 'shopTitle'), label('p', 'shopIntro', 'intro'));
  const foodButtons: { size: BagSize; node: HTMLButtonElement }[] = [];
  for (const size of ['small', 'medium', 'large'] as const) {
    const card = element('article', 'food-card');
    const description = element('div'); description.append(label('h3', size));
    const portions = element('p', 'muted');
    localizers.push(() => { portions.textContent = text('portions', { count: FOOD[size].portions }); });
    description.append(portions);
    const buy = actionButton('buy', { type: 'buy-food', size }, () => !save || save.run.wallet < FOOD[size].cost);
    foodButtons.push({ size, node: buy }); card.append(description, buy); panes.shop!.append(card);
  }
  const inventoryList = element('div', 'inventory-list');
  panes.shop!.append(label('h3', 'inventory', 'section-kicker'), inventoryList, button('feedNow', () => { closeSheet(); setMode('feed'); callbacks.onMode('feed'); }, 'button wide'));
  panes.gacha!.append(label('h2', 'gachaTitle'), label('p', 'gachaIntro', 'intro'));
  const tierCards: { tier: Tier; requirement: HTMLElement; odds: HTMLElement; node: HTMLButtonElement; pool: HTMLElement }[] = [];
  for (const tier of ['basic', 'standard', 'premium', 'legendary'] as const) {
    const card = element('article', `tier-card tier-${tier}`), heading = label('h3', tier);
    const requirement = element('p', 'tier-requirement'), odds = element('div', 'odds'), pool = element('details', 'pool-details');
    const poolHeading = label('summary', 'poolNames'); pool.append(poolHeading, element('p', 'muted'));
    const roll = actionButton('roll', { type: 'roll', tier }, () => !save || revealing || !GACHA[tier].ready(save) || save.run.wallet < GACHA[tier].cost || save.run.fish.length >= getCapacity(save.run));
    card.append(heading, requirement, label('span', 'actualOdds', 'section-kicker'), odds, pool, roll);
    panes.gacha!.append(card); tierCards.push({ tier, requirement, odds, node: roll, pool });
  }
  const gateGuide = element('details', 'pool-details species-gates'), gateList = element('div');
  gateGuide.append(label('summary', 'speciesGates'), gateList); panes.gacha!.append(gateGuide);
  const discoveryCount = element('p', 'discovery-count');
  panes.collection!.append(label('h2', 'collectionTitle'), discoveryCount, label('p', 'collectionIntro', 'intro'), label('h3', 'milestones', 'section-kicker'));
  const milestones = element('div', 'milestones');
  const milestoneCards: { id: string; status: HTMLElement; node: HTMLButtonElement }[] = [];
  for (const milestone of MILESTONES) {
    const card = element('article', 'milestone-card');
    const title = label('h4', `milestone-${milestone.id}`), fishName = element('p', 'muted'), status = element('span', 'milestone-status');
    localizers.push(() => { fishName.textContent = species(milestone.speciesId).name[locale]; });
    const claim = actionButton('claim', { type: 'claim-milestone', milestoneId: milestone.id }, () => !save || !milestone.ready(save) || save.run.claimedMilestones.includes(milestone.id) || save.run.fish.length >= getCapacity(save.run));
    card.append(title, fishName, status, claim); milestones.append(card); milestoneCards.push({ id: milestone.id, status, node: claim });
  }
  const collectionGrid = element('div', 'collection-grid');
  panes.collection!.append(milestones, collectionGrid);
  panes.upgrades!.append(label('h2', 'upgradesTitle'), label('p', 'filterIntro', 'intro'));
  const upgradeCards: { kind: 'bath' | 'filter'; info: HTMLElement; next: HTMLElement; node: HTMLButtonElement }[] = [];
  for (const kind of ['bath', 'filter'] as const) {
    const card = element('article', `upgrade-card upgrade-${kind}`), info = element('p'), next = element('p', 'muted');
    const upgrade = actionButton('upgrade', { type: kind === 'bath' ? 'upgrade-bath' : 'upgrade-filter' }, () => {
      if (!save) return true;
      const level = kind === 'bath' ? save.run.bathLevel : save.run.filterLevel;
      return level >= 4 || save.run.wallet < (kind === 'bath' ? BATH_COST : FILTER_COST)[level]!;
    });
    card.append(label('h3', kind), info, next, upgrade); panes.upgrades!.append(card); upgradeCards.push({ kind, info, next, node: upgrade });
  }
  panes.upgrades!.append(button('restart', callbacks.onRestart, 'button danger wide'));

  function showTab(): void {
    for (const name of Object.keys(panes)) panes[name]!.hidden = name !== tab;
    for (const [name, node] of Object.entries(tabButtons)) {
      node.setAttribute('aria-selected', String(name === tab)); node.tabIndex = name === tab ? 0 : -1;
    }
    tabs.hidden = tab === 'settings';
    sheetTitle.textContent = text(navKeys[tab]);
    for (const [name, node] of Object.entries(launchers)) node.setAttribute('aria-expanded', String(activeSheet === name));
  }
  function openSheet(view: SheetView): void {
    if (blocked || !recovery.hidden) return;
    const opening = activeSheet === null;
    if (opening) sheetOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activeSheet = tab = view; showTab();
    if (opening) { callbacks.onSheetChange(true); sheet.showModal(); sheetClose.focus(); }
  }
  function closeSheet(): void {
    if (activeSheet === null) return;
    const previousView = activeSheet; activeSheet = null; backdropDown = false; showTab();
    sheet.close(); callbacks.onSheetChange(false);
    const target = sheetOpener?.isConnected && sheetOpener.getClientRects().length && !sheetOpener.matches(':disabled') ? sheetOpener : launchers[previousView]!;
    if (!target.matches(':disabled') && target.getClientRects().length) target.focus({ preventScroll: true });
    else if (!gear.disabled && gear.getClientRects().length) gear.focus({ preventScroll: true });
    sheetOpener = null;
  }
  function setMode(next: Mode): void {
    mode = next;
    for (const value of ['inspect', 'feed', 'scrub'] as const) modeButtons[value]!.setAttribute('aria-pressed', String(value === mode));
    patchSceneFeedback();
    sceneHost.dataset.mode = mode;
  }
  function patchSceneFeedback(): void {
    if (mode === 'feed') {
      sceneControl.textContent = text('feed-control');
      sceneProgress.textContent = text('feed-progress', { count: num(sceneFeedback.dropped), remaining: num(remainingFood) });
      sceneProgress.hidden = false;
    } else {
      const hovered = save?.run.fish.find(fish => fish.id === sceneFeedback.hoveredFishId);
      sceneControl.textContent = mode === 'scrub' ? text('scrub-control') : hovered
        ? text('hover-fish', { name: species(hovered.speciesId).name[locale], id: hovered.id })
        : text('hint-inspect');
      sceneProgress.hidden = true;
    }
  }
  function localize(next: Locale): void {
    locale = next; document.documentElement.lang = next; document.title = text('title'); language.value = next;
    language.setAttribute('aria-label', text('language')); controls.setAttribute('aria-label', text('profileControls')); sceneHost.setAttribute('aria-label', text('title')); toolbar.setAttribute('aria-label', text('modes'));
    navigation.setAttribute('aria-label', text('gameNavigation')); tabs.setAttribute('aria-label', text('sheetTabs')); showTab();
    for (const apply of localizers) apply();
    for (const { size, node } of foodButtons) setButtonText(node, text('buy', { price: num(FOOD[size].cost) }));
    for (const { tier, node } of tierCards) setButtonText(node, text('roll', { price: num(GACHA[tier].cost) }));
    setButtonText(collect, text('collect', { amount: num(save?.run.pendingCoins ?? 0) }));
    shopSignature = gachaSignature = collectionSignature = upgradeSignature = rosterSignature = '';
    setMode(mode);
    if (lastFinished) sceneStatus.textContent = text('feed-finished', { count: num(lastFinished.count), remaining: num(lastFinished.remaining) });
    if (save) render(true);
  }
  function notify(message: string): void {
    window.clearTimeout(toastTimer); toast.textContent = message; toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 6000);
  }
  function dialog(title: () => string, body: () => string, confirmation: boolean, plate?: SpeciesSpec): { element: HTMLDialogElement; result: Promise<boolean> } {
    const modal = element('dialog', plate ? 'app-dialog reveal-dialog' : 'app-dialog');
    const result = new Promise<boolean>((resolve) => {
      const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const heading = element('h2'), description = element('p', 'dialog-body');
      const suffix = `${Date.now()}-${document.querySelectorAll('dialog').length}`;
      heading.id = `dialog-heading-${suffix}`; description.id = `dialog-body-${suffix}`;
      modal.setAttribute('aria-labelledby', heading.id); modal.setAttribute('aria-describedby', description.id);
      const actions = element('div', 'dialog-actions');
      const cancel = element('button', 'button'), accept = element('button', 'button primary'); cancel.type = accept.type = 'button';
      const translate = () => { heading.textContent = title(); description.textContent = body(); cancel.textContent = text('cancel'); accept.textContent = text(confirmation ? 'confirm' : 'close'); };
      localizers.push(translate); translate();
      modal.append(heading); if (plate) modal.append(fishPlate(plate, true)); modal.append(description, actions);
      if (confirmation) actions.append(cancel); actions.append(accept);
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true; dismissDialogs.delete(dismiss); modal.close(); modal.remove();
        const index = localizers.indexOf(translate); if (index >= 0) localizers.splice(index, 1);
        modalDepth--;
        if (modalDepth === 0) callbacks.onDialogChange(false);
        if (previous?.isConnected && previous.getClientRects().length && !previous.matches(':disabled')) previous.focus({ preventScroll: true });
        else if (sheet.open) sheetClose.focus({ preventScroll: true });
        resolve(result);
      };
      const dismiss = () => finish(false); dismissDialogs.add(dismiss);
      cancel.addEventListener('click', () => finish(false)); accept.addEventListener('click', () => finish(true));
      modal.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
      root.append(modal); modal.showModal(); modalDepth++; callbacks.onDialogChange(true);
      (confirmation ? cancel : accept).focus();
      if (plate) window.setTimeout(() => finish(true), 1500);
    });
    return { element: modal, result };
  }
  let selectionKey = '';
  let selectionReadouts: Record<string, HTMLElement> = {};
  let selectionExtra: HTMLElement | null = null;
  let selectionSell: HTMLButtonElement | null = null;
  function renderFish(force = false): void {
    if (!save) return;
    const now = performance.now();
    if (!force && now - lastRoster < 1000) return;
    lastRoster = now;
    const run = save.run;
    const signature = JSON.stringify([locale, selectedId, sort.value, run.fish.map(f => [f.id, f.speciesId, Math.floor(f.hunger), Math.floor(f.growth * 100), getFishStats(species(f.speciesId), f.growth).saleValue, Math.round(getIncomePerMinute(run, f) * 10)])]);
    if (signature === rosterSignature) return;
    rosterSignature = signature;
    const selectedFish = run.fish.find(f => f.id === selectedId);
    const nextSelectionKey = `${run.id}:${selectedFish?.id ?? ''}:${locale}`;
    if (nextSelectionKey !== selectionKey) {
      selectionKey = nextSelectionKey;
      selected.classList.toggle('is-empty', !selectedFish);
      selectedHeading.hidden = !selectedFish;
      if (sheet.open && selectedContent.contains(document.activeElement)) sheetClose.focus({ preventScroll: true });
      selectedContent.replaceChildren();
      selectionReadouts = {};
      selectionExtra = null;
      selectionSell = null;
      if (!selectedFish) {
        selectedContent.append(element('p', 'muted', text('noSelection')));
      } else {
        const spec = species(selectedFish.speciesId);
        const intro = element('div', 'fish-detail-intro');
        const name = element('div');
        const stage = element('span', `rarity rarity-${spec.rarity}`);
        selectionReadouts.stage = stage;
        name.append(element('h3', '', spec.name[locale]), element('p', 'fish-id', text('fishIdentity', { id: selectedFish.id })), stage);
        intro.append(fishPlate(spec, true), name);
        selectedContent.append(intro, element('p', 'muted', spec.signature[locale]));
        const statsList = element('dl', 'fish-stats');
        for (const key of ['hunger', 'growth', 'income', 'sale']) {
          const item = element('div'), value = element('dd');
          item.append(element('dt', '', text(key)), value);
          statsList.append(item);
          selectionReadouts[key] = value;
        }
        selectionExtra = element('p', 'micro');
        selectionSell = element('button', 'button danger wide');
        selectionSell.type = 'button';
        const fishId = selectedFish.id;
        selectionSell.addEventListener('click', () => { if (!blocked) callbacks.onAction({ type: 'sell', fishId }); });
        selectedContent.append(statsList, selectionExtra, selectionSell);
        const clear = element('button', 'button subtle wide', text('clear-selection')); clear.type = 'button';
        clear.addEventListener('click', () => { if (!blocked) callbacks.onSelectFish(null); }); selectedContent.append(clear);
      }
    }
    if (selectedFish && selectionSell && selectionExtra) {
      const spec = species(selectedFish.speciesId), stats = getFishStats(spec, selectedFish.growth);
      selectionReadouts.stage!.textContent = `${text(spec.rarity === 'legendary' ? 'rarity-legendary' : spec.rarity)} · ${text(selectedFish.growth >= 1 ? 'adult' : 'juvenile')}`;
      selectionReadouts.hunger!.textContent = `${num(selectedFish.hunger)}%`;
      selectionReadouts.growth!.textContent = `${num(selectedFish.growth * 100)}%`;
      selectionReadouts.income!.textContent = num(getIncomePerMinute(run, selectedFish));
      selectionReadouts.sale!.textContent = num(stats.saleValue);
      selectionExtra.textContent = `${text('growthTime', { time: formatTime(locale, stats.growthSeconds) })} · ${text('appetite', { count: num(stats.appetite) })}`;
      selectionSell.textContent = text('sell', { price: num(stats.saleValue) });
      selectionSell.disabled = blocked;
    }
    const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.fishId : undefined;
    const fish = [...run.fish];
    const collator = new Intl.Collator(locale);
    fish.sort((a: FishState, b: FishState) => {
      let order = 0;
      switch (sort.value) {
        case 'name': order = collator.compare(species(a.speciesId).name[locale], species(b.speciesId).name[locale]); break;
        case 'hunger': order = a.hunger - b.hunger; break;
        case 'growth': order = a.growth - b.growth; break;
        case 'income': order = getIncomePerMinute(run, b) - getIncomePerMinute(run, a); break;
        case 'sale': order = getFishStats(species(b.speciesId), b.growth).saleValue - getFishStats(species(a.speciesId), a.growth).saleValue; break;
      }
      return order || collator.compare(a.id, b.id);
    });
    const rows: HTMLElement[] = [];
    for (const f of fish) {
      const spec = species(f.speciesId), row = element('button', `roster-row${f.id === selectedId ? ' is-selected' : ''}`); row.type = 'button'; row.dataset.fishId = f.id;
      row.setAttribute('aria-pressed', String(f.id === selectedId)); row.disabled = blocked;
      row.append(element('strong', '', spec.name[locale]), element('span', 'fish-id', f.id), element('span', 'micro', text('statsLine', { hunger: Math.floor(f.hunger), growth: Math.floor(f.growth * 100), income: num(getIncomePerMinute(run, f)), sale: num(getFishStats(spec, f.growth).saleValue) })));
      row.addEventListener('click', () => callbacks.onSelectFish(f.id)); rows.push(row);
    }
    if (!rows.length) rows.push(element('p', 'muted', text('emptyFish')));
    rosterList.replaceChildren(...rows);
    if (focusedId) [...rosterList.querySelectorAll<HTMLButtonElement>('button')].find(node => node.dataset.fishId === focusedId)?.focus({ preventScroll: true });
  }
  function render(force = false): void {
    if (!save) return;
    const run = save.run;
    const bags = run.foodBags.filter(b => b.remaining > 0 && b.expiresAtActiveSeconds > run.activeSeconds).sort((a,b) => a.expiresAtActiveSeconds - b.expiresAtActiveSeconds);
    const food = bags.reduce((sum, bag) => sum + bag.remaining, 0), nextExpiry = bags[0] ? bags[0].expiresAtActiveSeconds - run.activeSeconds : null;
    remainingFood = food; patchSceneFeedback();
    const clean = getCleanliness(run), capacity = getCapacity(run);
    resourceValues.wallet!.textContent = num(run.wallet);
    resourceValues.fish!.textContent = `${run.fish.length} / ${capacity}`; resourceValues.cleanliness!.textContent = `${num(clean)}%`;
    resourceValues.food!.textContent = num(food);
    setButtonText(collect, text('collect', { amount: num(run.pendingCoins) })); setButtonText(mute, text(save.settings.muted ? 'soundOff' : 'soundOn')); mute.setAttribute('aria-pressed', String(!save.settings.muted));
    const care: string[] = [];
    const starving = run.fish.filter(f => f.hunger === 0).length, hungry = run.fish.filter(f => f.hunger > 0 && f.hunger < 30).length;
    if (starving) care.push(text('warning-starving', { count: starving }));
    else if (hungry) care.push(text('warning-hungry', { count: hungry }));
    if (clean < 60) care.push(text('warning-dirty'));
    if (!food) care.push(text('warning-no-food'));
    if (nextExpiry !== null && nextExpiry <= 600) care.push(text('warning-expiry', { time: formatTime(locale, nextExpiry) }));
    if (run.fish.length >= capacity) care.push(text('warning-full'));
    const warningText = care.join(' ');
    if (warnings.textContent !== warningText) warnings.textContent = warningText;
    warnings.hidden = !care.length;
    const shopKey = JSON.stringify([locale, bags.map(b => [b.id, b.remaining, Math.ceil((b.expiresAtActiveSeconds - run.activeSeconds) / 10)])]);
    if (shopKey !== shopSignature) {
      shopSignature = shopKey;
      inventoryList.replaceChildren(...(bags.length ? bags.map(b => {
        const row = element('div', 'bag-row');
        row.append(element('span', 'fish-id', text('bag', { id: b.id })), element('span', '', text('bagRemaining', { count: b.remaining, time: formatTime(locale, b.expiresAtActiveSeconds - run.activeSeconds) })));
        if (b.expiresAtActiveSeconds - run.activeSeconds <= 600) row.classList.add('expiring');
        return row;
      }) : [element('p', 'muted', text('emptyPantry'))]));
    }
    for (const { size, node } of foodButtons) setButtonText(node, text('buy', { price: num(FOOD[size].cost) }));
    const gachaKey = JSON.stringify([locale, run.totalFed, run.adultsRaised, run.bathLevel, run.filterLevel, save.discovered.length, revealing]);
    if (gachaKey !== gachaSignature) {
      gachaSignature = gachaKey;
      for (const { tier, requirement, odds, node, pool } of tierCards) {
        requirement.textContent = tier === 'basic' ? text('tierOpen') : text(`tier-${tier}`, { count: tier === 'standard' ? run.totalFed : tier === 'premium' ? run.adultsRaised : save.discovered.length, level: run.bathLevel });
        requirement.classList.toggle('is-locked', !GACHA[tier].ready(save));
        const actual = getGachaOdds(save, tier);
        odds.replaceChildren(...actual.map(odd => element('span', `odds-chip rarity-${odd.rarity}`, `${text(odd.rarity === 'legendary' ? 'rarity-legendary' : odd.rarity)} ${num(odd.probability * 100)}%`)));
        const description = pool.querySelector('p')!;
        pool.querySelector('summary')!.textContent = `${text('poolNames')} · ${text('pool', { count: actual.reduce((total, odd) => total + odd.speciesIds.length, 0) })}`;
        description.textContent = actual.map(odd => `${text(odd.rarity === 'legendary' ? 'rarity-legendary' : odd.rarity)}: ${odd.speciesIds.map(id => species(id).name[locale]).join(', ')}`).join(' · ');
        setButtonText(node, revealing ? text('revealing') : text('roll', { price: num(GACHA[tier].cost) }));
      }
      gateList.replaceChildren(...CATALOG.filter(spec => spec.acquisition !== 'milestone' && spec.gate !== 'none').map(spec => {
        const open = isGateOpen(run, spec.gate);
        return element('p', 'micro', `${spec.name[locale]} · ${text(`gate-${spec.gate}`)} · ${text(open ? 'gateOpen' : 'gateClosed')}`);
      }));
    }
    const collectionKey = JSON.stringify([locale, save.discovered, run.adultsRaised, run.totalFed, run.bathLevel, run.filterLevel, run.claimedMilestones, run.fish.length]);
    if (collectionKey !== collectionSignature) {
      collectionSignature = collectionKey;
      discoveryCount.textContent = text('discovery', { count: save.discovered.length });
      for (const { id, status, node } of milestoneCards) {
        const milestone = MILESTONES.find(m => m.id === id)!;
        const claimed = run.claimedMilestones.includes(id), ready = milestone.ready(save);
        status.textContent = text(claimed ? 'claimed' : ready ? 'ready' : 'notReady');
        status.classList.toggle('is-ready', ready && !claimed);
        setButtonText(node, claimed ? text('claimed') : ready && run.fish.length >= capacity ? text('full-bath') : text('claim'));
      }
      const expanded = new Set([...collectionGrid.querySelectorAll<HTMLDetailsElement>('details[open]')].map(node => node.dataset.speciesId));
      collectionGrid.replaceChildren(...CATALOG.map(spec => {
        const known = save!.discovered.includes(spec.id), card = element('article', `collection-card${known ? ' is-discovered' : ' is-undiscovered'}`);
        card.append(element('span', 'plate-number', String(spec.index + 1).padStart(2, '0')), fishPlate(spec, known), element('h3', '', spec.name[locale]), element('span', `rarity rarity-${spec.rarity}`, text(spec.rarity === 'legendary' ? 'rarity-legendary' : spec.rarity)), element('p', 'micro', text(known ? 'discovered' : 'undiscovered')));
        const detail = element('details'), summary = element('summary', 'micro', spec.signature[locale]);
        detail.dataset.speciesId = spec.id; detail.open = expanded.has(spec.id);
        const source = spec.acquisition === 'milestone' ? text('milestoneOnly') : spec.acquisition === 'starter-and-gacha' ? text('starterSource') : text('gachaSource');
        detail.append(summary, element('p', 'micro', `${source} · ${text(`gate-${spec.gate}`)} · ${text(isGateOpen(run, spec.gate) ? 'gateOpen' : 'gateClosed')}`));
        const stats = getFishStats(spec, 1);
        detail.append(element('p', 'micro', `${text('income')}: ${num(stats.incomePerMinute)} · ${text('growthTime', { time: formatTime(locale, stats.growthSeconds) })}`));
        card.append(detail); return card;
      }));
    }
    const upgradeKey = `${locale}:${run.bathLevel}:${run.filterLevel}`;
    if (upgradeKey !== upgradeSignature) {
      upgradeSignature = upgradeKey;
      for (const { kind, info, next, node } of upgradeCards) {
        const level = kind === 'bath' ? run.bathLevel : run.filterLevel;
        info.textContent = `${text('level', { level })} · ${kind === 'bath' ? text('capacity', { count: capacity }) : text('filterPower', { count: FILTER_POWER[level]! })}`;
        next.textContent = level === 4 ? text('maxLevel') : kind === 'bath' ? text('nextCapacity', { count: CAPACITY[level + 1]! }) : text('filterPower', { count: FILTER_POWER[level + 1]! });
        setButtonText(node, level === 4 ? text('maxLevel') : text('upgrade', { price: num((kind === 'bath' ? BATH_COST : FILTER_COST)[level]!) }));
      }
    }
    refreshControls(); renderFish(force);
  }
  localize(locale); showTab(); setMode('inspect'); refreshControls();
  return {
    sceneHost,
    update(next, events = []) {
      save = next;
      if (locale !== next.settings.language) localize(next.settings.language);
      const immediate = events.some(event => event.type !== 'coin-drop');
      render(immediate);
      for (const event of events) {
        if (event.type === 'coin-drop') continue;
        if (event.type === 'food-expired') notify(text('event-expired', { count: event.amount }));
        else if (event.type === 'milestone-ready') notify(text('event-ready'));
        else {
          const key = { 'fish-grown': 'event-grown', 'fish-left': 'event-left', 'fish-acquired': 'event-acquired', 'fish-sold': 'event-sold' }[event.type];
          notify(text(key, { name: species(event.speciesId).name[locale], price: event.amount ?? 0 }));
        }
      }
    },
    setMode,
    setSceneFeedback(feedback) {
      const finished = sceneFeedback.feeding && !feedback.feeding && feedback.dropped > 0;
      sceneFeedback = { ...feedback };
      patchSceneFeedback();
      if (finished) {
        lastFinished = {count:feedback.dropped,remaining:remainingFood};
        sceneStatus.textContent = text('feed-finished', { count: num(lastFinished.count), remaining: num(lastFinished.remaining) });
      }
    },
    selectFish(id, openDetails = false) { selectedId = id && save?.run.fish.some(f => f.id === id) ? id : null; renderFish(true); if (openDetails && selectedId) openSheet('fish'); },
    notify,
    showOffline(summary) {
      if (summary.seconds <= 0) return;
      offlineTotals = { seconds: offlineTotals.seconds + summary.seconds, coins: offlineTotals.coins + summary.coins, adults: offlineTotals.adults + summary.adults };
      const body = () => text('offlineBody', { time: formatTime(locale, offlineTotals.seconds), coins: num(offlineTotals.coins), adults: offlineTotals.adults });
      if (offlineDialog?.open) {
        offlineDialog.querySelector('.dialog-body')!.textContent = body();
        return;
      }
      const closed = dialog(() => text('offlineTitle'), body, false);
      offlineDialog = closed.element;
      void closed.result.finally(() => { offlineDialog = null; offlineTotals = { seconds: 0, coins: 0, adults: 0 }; });
    },
    confirm(title, body) { return dialog(() => title, () => body, true).result; },
    setBlocked(message) {
      blocked = true; closeSheet(); for (const dismiss of [...dismissDialogs]) dismiss();
      bannerMessage.textContent = message; banner.hidden = false;
      sceneHost.style.pointerEvents = 'none'; language.disabled = true; mute.disabled = true; sort.disabled = true;
      rosterSignature = ''; refreshControls(); renderFish(true);
    },
    async reveal(spec) {
      revealing = true; gachaSignature = ''; render();
      const started = performance.now();
      try {
        await dialog(() => text('revealTitle'), () => `${spec.name[locale]} · ${text(spec.rarity === 'legendary' ? 'rarity-legendary' : spec.rarity)}. ${text('revealBaby')}`, false, spec).result;
        const remaining = 1500 - (performance.now() - started);
        if (remaining > 0) await new Promise<void>(resolve => window.setTimeout(resolve, remaining));
      } finally { revealing = false; gachaSignature = ''; render(); }
    },
    showRecovery(raw, onNew) {
      blocked = true; closeSheet(); for (const dismiss of [...dismissDialogs]) dismiss();
      refreshControls(); header.hidden = layout.hidden = dock.hidden = navigation.hidden = resources.hidden = warnings.hidden = true;
      banner.hidden = true; recovery.hidden = false;
      const title = label('h2', 'recoveryTitle'), body = label('p', 'recoveryBody', 'intro');
      const download = button('corruptDownload', () => {
        const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
        const link = element('a'); link.href = url; link.download = 'bathtub-aquarium-corrupt-save.json'; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'button', true);
      const fresh = button('newGame', () => {
        void dialog(() => text('recovery-new-title'), () => text('recovery-new-body'), true).result.then(confirmed => {
          if (!confirmed) return;
          blocked = false; recovery.hidden = true; header.hidden = layout.hidden = dock.hidden = navigation.hidden = resources.hidden = false;
          sceneHost.style.pointerEvents = ''; language.disabled = sort.disabled = false; onNew(); refreshControls();
        });
      }, 'button primary', true);
      recovery.replaceChildren(title, body, download, fresh);
    },
  };
}
