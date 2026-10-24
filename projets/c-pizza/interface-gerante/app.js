import { SITES, HOURS, HOURLY, TYPICAL, LEVELS, QUARTIERS, DRIVERS, LAST_FRIDAY } from './data.js';

const LEVEL_COLORS = ['#EFE5D6', '#F3D9C2', '#EBB08F', '#D9785A'];
const VB = { x: 20, y: 30, w: 760, h: 480 };
const TICK_MS = 4000;
const num = new Intl.NumberFormat('fr-FR');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  selected: 2,
  view: 'direct',
  live: !reduceMotion,
  minutes: 19 * 60 + 6,
  revenue: 742000,
  om: 47,
  momo: 39,
  flash: null,
  sites: SITES.map((s) => ({ ...s, paused: false, rerouted: false, calzoneBack: false, reinforcement: false })),
  hourly: { 1: [...HOURLY[1]], 2: [...HOURLY[2]], 3: [...HOURLY[3]] },
};

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const site = (id) => state.sites.find((s) => s.id === id);
const pos = (v, start, size) => `${(((v - start) / size) * 100).toFixed(2)}%`;
const pad = (n) => String(n).padStart(2, '0');
const clock = () => `${pad(Math.floor(state.minutes / 60))}:${pad(state.minutes % 60)}`;
const hourIndex = () => Math.min(12, Math.max(0, Math.floor((state.minutes - 11 * 60) / 60)));
const totalCmd = () => state.sites.reduce((n, s) => n + s.cmd, 0);
const charge = (s) => Math.min(100, s.cuisine * 15);

// --- Règles métier de la démo ---

function status(s) {
  if (s.paused) return { label: 'En pause', tone: 'muted' };
  if (s.id === 2 && s.rerouted) return { label: s.late ? `${s.late} en retard · redirigé` : 'Redirigé vers le PV 1', tone: 'warn' };
  if (s.late > 0) return { label: `${s.late} en retard`, tone: 'warn' };
  return { label: 'Ouvert', tone: 'ok' };
}

function note(s) {
  if (s.paused) return 'En pause : le bot ne prend plus de commandes pour ce point de vente.';
  if (s.id === 2 && !s.rerouted) return `${s.late} commandes ont dépassé le délai annoncé de plus de 10 min.`;
  if (s.id === 2) return 'Les nouvelles commandes partent au Point de vente 1, le temps de rattraper le retard.';
  if (s.id === 1 && !s.calzoneBack) return 'Calzone épuisée depuis 18:40 : le bot ne la propose plus ici.';
  if (s.id === 3 && !s.reinforcement) return 'Un seul livreur en ligne ce soir.';
  if (s.id === 3) return 'Renfort demandé : en attente de la réponse d’un livreur.';
  return '';
}

function urgency(s) {
  if (s.id === 2 && !s.rerouted && !s.paused && s.late > 0) return 3;
  return note(s) ? 2 : 1;
}

function alertsList() {
  const items = [];
  state.sites.forEach((s) => {
    if (s.paused) items.push({ site: s.id, level: 2, text: `${s.name} en pause`, action: 'Reprendre les commandes' });
    if (s.id === 2 && !s.rerouted && s.late > 0) items.push({ site: 2, level: 3, text: `Point de vente 2 : ${s.late} commandes en retard de plus de 10 min`, action: 'Voir le point de vente' });
    if (s.id === 2 && s.rerouted) items.push({ site: 2, level: 1, text: 'Point de vente 2 : commandes redirigées vers le PV 1', action: 'Voir le point de vente' });
    if (s.id === 1 && !s.calzoneBack) items.push({ site: 1, level: 2, text: 'Calzone épuisée au Point de vente 1 depuis 18:40', action: 'Remettre en vente' });
    if (s.id === 3 && !s.reinforcement) items.push({ site: 3, level: 2, text: 'Point de vente 3 : un seul livreur en ligne', action: 'Demander un renfort' });
  });
  return items.sort((a, b) => b.level - a.level);
}

function actionsFor(s) {
  const list = [];
  if (s.id === 1) list.push(s.calzoneBack ? { key: 'calzone', label: 'Calzone remise en vente', disabled: true } : { key: 'calzone', label: 'Remettre la Calzone en vente' });
  if (s.id === 2) list.push({ key: 'reroute', label: s.rerouted ? 'Reprendre les commandes ici' : 'Envoyer les nouvelles commandes au PV 1' });
  if (s.id === 3) list.push(s.reinforcement ? { key: 'renfort', label: 'Renfort demandé', disabled: true } : { key: 'renfort', label: 'Demander un livreur en renfort' });
  return list;
}

// --- Carte en 3D ---

function tilePoints(i, j) {
  const x = 400 + 90 * (i - j);
  const y = 90 + 50 * (i + j);
  return `${x},${y} ${x + 90},${y + 50} ${x},${y + 100} ${x - 90},${y + 50}`;
}

function towerPolys({ cx, cy }, h) {
  const w = 30;
  const d = 17;
  return {
    top: `${cx},${cy - h - d} ${cx + w},${cy - h} ${cx},${cy - h + d} ${cx - w},${cy - h}`,
    left: `${cx - w},${cy - h} ${cx},${cy - h + d} ${cx},${cy + d} ${cx - w},${cy}`,
    right: `${cx},${cy - h + d} ${cx + w},${cy - h} ${cx + w},${cy} ${cx},${cy + d}`,
  };
}

function towerColors(s) {
  if (s.paused) return { top: '#CFC6BB', left: '#A99E92', right: '#8C8176' };
  return { top: s.id === state.selected ? '#F2B33D' : '#E8664A', left: '#B8381F', right: '#8F2A16' };
}

function towerSub(s) {
  if (s.paused) return 'En pause';
  if (s.late > 0) return `${s.late} en retard`;
  if (s.id === 3 && !s.reinforcement) return '1 seul livreur';
  return `${s.cuisine} en cuisine · aucun retard`;
}

function renderMap() {
  const q = state.view === 'quartiers';
  const max = Math.max(...state.sites.map((s) => s.cmd));
  const height = (s) => Math.round(20 + (s.cmd / max) * 110);

  let tiles = '';
  for (let j = 0; j < 4; j += 1) {
    for (let i = 0; i < 4; i += 1) {
      const fill = q ? LEVEL_COLORS[LEVELS[j * 4 + i]] : '#EFE5D6';
      tiles += `<polygon points="${tilePoints(i, j)}" fill="${fill}" stroke="#FFFFFF" stroke-width="5"/>`;
    }
  }
  const routes = q ? '' : DRIVERS.map((d) => {
    const s = site(d.site);
    return `<line x1="${s.cx}" y1="${s.cy}" x2="${d.x}" y2="${d.y}" stroke="#B8381F" stroke-width="3" stroke-dasharray="6 6"/>`;
  }).join('');
  const rings = state.sites.filter((s) => s.id === state.selected)
    .map((s) => `<ellipse cx="${s.cx}" cy="${s.cy}" rx="46" ry="26" fill="none" stroke="#F2B33D" stroke-width="4"/>`).join('');
  const towers = [...state.sites].sort((a, b) => a.cy - b.cy).map((s) => {
    const p = towerPolys(s, height(s));
    const c = towerColors(s);
    return `<g opacity="${q ? 0.35 : 1}"><polygon points="${p.left}" fill="${c.left}"/><polygon points="${p.right}" fill="${c.right}"/><polygon points="${p.top}" fill="${c.top}"/></g>`;
  }).join('');
  const drivers = q ? '' : DRIVERS.map((d) => `<circle cx="${d.x}" cy="${d.y}" r="9" fill="#221C18" stroke="#F2B33D" stroke-width="3"/>`).join('');

  const aria = q
    ? 'Carte en 3D des quartiers, colorés selon le nombre de commandes du jour'
    : `Carte en 3D : ${state.sites.map((s) => `${s.name}, ${s.cmd} commandes`).join(' ; ')} ; ${DRIVERS.length} livreurs en course`;

  const labels = state.sites.map((s) => {
    const top = s.cy - height(s) - 17 - 6;
    const cls = ['tower-label', s.id === state.selected ? 'is-selected' : '', state.flash === s.id ? 'bump' : ''].join(' ');
    return `<button type="button" class="${cls}" data-action="select" data-site="${s.id}" data-key="tower-${s.id}" aria-pressed="${s.id === state.selected}" style="left:${pos(s.cx, VB.x, VB.w)};top:${pos(top, VB.y, VB.h)}">`
      + `<span class="lbl-long">${esc(s.name)} · ${s.cmd}</span><span class="lbl-short">${esc(s.short)} · ${s.cmd}</span><span class="lbl-sub">${esc(towerSub(s))}</span></button>`;
  }).join('');
  const driverLabels = q ? '' : DRIVERS.map((d) => `<span class="driver-label" style="left:${pos(d.x, VB.x, VB.w)};top:${pos(d.y - 12, VB.y, VB.h)}">${esc(d.name)}</span>`).join('');
  const quartierLabels = !q ? '' : QUARTIERS.map((z) => {
    const i = z.tile % 4;
    const j = Math.floor(z.tile / 4);
    const x = 400 + 90 * (i - j);
    const y = 90 + 50 * (i + j) + 50;
    return `<span class="q-label" style="left:${pos(x, VB.x, VB.w)};top:${pos(y, VB.y, VB.h)}">${esc(z.name)} · ${z.count}</span>`;
  }).join('');

  $('map').innerHTML = `<svg viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" role="img" aria-label="${esc(aria)}">${tiles}${routes}${rings}${towers}${drivers}</svg>${driverLabels}${quartierLabels}${labels}`;

  $('map-title').textContent = q ? 'D’où viennent les commandes' : 'La ville en ce moment';
  $('map-sub').textContent = q ? 'Commandes du jour par quartier' : 'Hauteur des tours = commandes du jour · points = livreurs en course';
  document.querySelectorAll('[data-action="view"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  $('legend').hidden = !q;
}

// --- Graphique par heure ---

function renderChart() {
  const idx = hourIndex();
  const sel = state.selected;
  const totals = HOURS.map((_, i) => state.hourly[1][i] + state.hourly[2][i] + state.hourly[3][i]);
  const k = 120 / Math.max(...TYPICAL, ...totals);
  $('chart').innerHTML = HOURS.map((h, i) => {
    const past = i <= idx;
    const tot = totals[i];
    const mine = state.hourly[sel][i];
    const ghost = i >= idx ? `<div class="bar-ghost" style="height:${(TYPICAL[i] * k).toFixed(1)}px"></div>` : '';
    const stack = past ? `<div class="bar-stack"><div class="bar-rest" style="height:${((tot - mine) * k).toFixed(1)}px"></div><div class="bar-mine" style="height:${(mine * k).toFixed(1)}px"></div></div>` : '';
    return `<div class="bar${i === idx ? ' is-now' : ''}${past ? '' : ' is-future'}"><span class="bar-val">${past ? tot : `≈ ${TYPICAL[i]}`}</span><div class="bar-track">${ghost}${stack}</div><span class="bar-hour">${h}</span></div>`;
  }).join('');
  $('chart').setAttribute('aria-label', `Commandes par heure, ${site(sel).name} en rouge : ${HOURS.slice(0, idx + 1).map((h, i) => `${h} ${totals[i]}`).join(', ')}`);
  $('chart-mine').textContent = site(sel).name;
  if (!chartScrolled) {
    // Sur petit écran, le graphique défile : on le place sur l'heure en cours.
    const box = document.querySelector('.chart-scroll');
    const now = $('chart').querySelector('.is-now');
    if (box && now && box.scrollWidth > box.clientWidth) {
      box.scrollLeft += now.getBoundingClientRect().left - box.getBoundingClientRect().left - box.clientWidth / 2 + now.offsetWidth / 2;
    }
    chartScrolled = true;
  }
}
let chartScrolled = false;

// --- Chiffres du jour ---

function renderKpis() {
  const total = totalCmd();
  const delta = Math.round((total / LAST_FRIDAY - 1) * 100);
  const omPct = Math.round((state.om / (state.om + state.momo)) * 100);
  $('kpis').innerHTML = `
    <div class="kpi"><span class="kpi-val">${total}</span><span class="kpi-name">commandes</span><span class="kpi-sub">${delta >= 0 ? '+' : ''}${delta} % sur vendredi dernier</span></div>
    <div class="kpi"><span class="kpi-val">${num.format(state.revenue)}</span><span class="kpi-name">FCFA encaissés</span><span class="kpi-sub">panier moyen ${num.format(Math.round(state.revenue / total / 10) * 10)} FCFA</span></div>
    <div class="kpi"><span class="kpi-val">14 min</span><span class="kpi-name">de préparation</span><span class="kpi-sub">objectif : 15 min</span></div>
    <div class="kpi"><span class="kpi-val">22 min</span><span class="kpi-name">de livraison</span><span class="kpi-sub">objectif : 25 min</span></div>
    <div class="kpi kpi-pay"><span class="kpi-name">Paiements du jour</span>
      <div class="paybar" role="img" aria-label="Orange Money ${omPct} %, MoMo ${100 - omPct} %"><i style="flex:${omPct}" class="om"></i><i style="flex:${100 - omPct}" class="momo"></i></div>
      <span class="paylegend"><span><i class="sw om"></i>Orange Money ${omPct} %</span><span><i class="sw momo"></i>MoMo ${100 - omPct} %</span></span>
    </div>`;
}

// --- Alertes ---

function renderAlerts() {
  const list = alertsList();
  $('alerts').innerHTML = list.length
    ? list.map((a, i) => `<button type="button" class="alert${a.level === 3 ? ' is-warn' : ''}" data-action="select" data-site="${a.site}" data-key="alert-${a.site}-${i}"><span class="dot" aria-hidden="true"></span><span class="alert-text"><strong>${esc(a.text)}</strong><span class="act">${esc(a.action)}</span></span></button>`).join('')
    : '<p class="sub">Rien à signaler pour le moment.</p>';
}

// --- Portefeuille des points de vente ---

function renderWallet() {
  const cur = site(state.selected);
  const others = state.sites.filter((s) => s.id !== cur.id).sort((a, b) => urgency(a) - urgency(b));
  const peeks = others.map((s, i) => {
    const st = status(s);
    const line = st.tone === 'ok' ? `${s.cmd} cmd · ${note(s) ? 'à surveiller' : 'tout va bien'}` : st.label;
    return `<button type="button" class="peek peek-${i}" data-action="select" data-site="${s.id}" data-key="peek-${s.id}"><span class="name">${esc(s.name)}</span><span class="line tone-${st.tone}">${esc(line)}</span></button>`;
  }).join('');

  const st = status(cur);
  const n = note(cur);
  const level = charge(cur);
  const actions = actionsFor(cur).map((a) => `<button type="button" class="btn btn-primary" data-action="${a.key}" data-key="act-${a.key}"${a.disabled ? ' disabled' : ''}>${esc(a.label)}</button>`).join('');

  $('wallet').innerHTML = `${peeks}
    <article class="front" aria-labelledby="front-title">
      <div class="front-head"><h3 id="front-title">${esc(cur.name)}</h3><span class="chip tone-${st.tone}">${esc(st.label)}</span></div>
      ${n ? `<p class="note">${esc(n)}</p>` : ''}
      <div class="stats">
        <div class="stat"><b>${cur.cmd}</b><span>commandes</span></div>
        <div class="stat"><b>${cur.cuisine}</b><span>en cuisine</span></div>
        <div class="stat"><b>${cur.attente} min</b><span>d’attente</span></div>
      </div>
      <div class="meter-wrap">
        <div class="meter-head"><span>Charge de la cuisine</span><span>${level} %</span></div>
        <div class="meter" role="img" aria-label="Charge de la cuisine ${level} %"><i class="${level >= 80 ? 'is-high' : ''}" style="width:${level}%"></i></div>
      </div>
      <p class="small">Livreurs : ${esc(cur.livreurs)}</p>
      <div class="top"><span class="small">Les plus vendues ce soir</span>
        <ul class="top-list">${cur.top.map(([name, qty]) => `<li>${esc(name)} · ${qty}${cur.id === 1 && name === 'Calzone' && !cur.calzoneBack ? ' (épuisée)' : ''}</li>`).join('')}</ul>
      </div>
      <div class="actions">
        ${actions}
        <div class="actions-row">
          <button type="button" class="btn btn-ghost" data-action="pause" data-key="act-pause">${cur.paused ? 'Reprendre' : 'Pause 15 min'}</button>
          <button type="button" class="btn btn-ghost" data-action="call" data-key="act-call">Appeler</button>
        </div>
      </div>
    </article>`;
}

// --- Tableau de comparaison ---

function renderCompare() {
  const rows = state.sites.map((s) => `
    <tr class="${s.id === state.selected ? 'is-selected' : ''}">
      <th scope="row"><button type="button" class="linkish" data-action="select" data-site="${s.id}" data-key="cmp-${s.id}" aria-pressed="${s.id === state.selected}">${esc(s.name)}</button></th>
      <td data-label="Commandes">${s.cmd}</td>
      <td data-label="Panier moyen">${num.format(s.panier)} FCFA</td>
      <td data-label="Préparation">${s.prep} min</td>
      <td data-label="Livraison">${s.livr} min</td>
      <td data-label="Annulées">${s.annul}</td>
    </tr>`).join('');
  $('compare').innerHTML = `<table class="compare"><thead><tr><th scope="col">Point de vente</th><th scope="col">Commandes</th><th scope="col">Panier moyen</th><th scope="col">Préparation</th><th scope="col">Livraison</th><th scope="col">Annulées</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// --- Rendu ---

function render() {
  const focusedKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
  $('clock').textContent = clock();
  renderKpis();
  renderMap();
  renderChart();
  renderAlerts();
  renderWallet();
  renderCompare();
  const live = $('live');
  live.setAttribute('aria-pressed', String(state.live));
  $('live-text').textContent = state.live ? 'En direct' : 'Démo en pause';
  if (focusedKey) {
    const el = document.querySelector(`[data-key="${focusedKey}"]`);
    if (el) el.focus({ preventScroll: true });
  }
  state.flash = null;
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 3200);
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const cur = site(state.selected);
  if (action === 'soon') {
    event.preventDefault();
    toast('Cet écran fait partie de la prochaine étape.');
    return;
  }
  if (action === 'select') state.selected = Number(el.dataset.site);
  if (action === 'view') state.view = el.dataset.view;
  if (action === 'live') state.live = !state.live;
  if (action === 'calzone') {
    cur.calzoneBack = true;
    toast('Calzone remise en vente : le bot la propose de nouveau au Point de vente 1.');
  }
  if (action === 'reroute') {
    cur.rerouted = !cur.rerouted;
    toast(cur.rerouted ? 'Les nouvelles commandes du Point de vente 2 partent au Point de vente 1.' : 'Le Point de vente 2 reprend ses commandes.');
  }
  if (action === 'renfort') {
    cur.reinforcement = true;
    toast('Message envoyé aux livreurs disponibles pour le Point de vente 3.');
  }
  if (action === 'pause') {
    cur.paused = !cur.paused;
    toast(cur.paused ? `${cur.name} en pause : le bot annonce un délai et propose un autre site.` : `${cur.name} reprend les commandes.`);
  }
  if (action === 'call') toast(`Appel du responsable du ${cur.name} (démo).`);
  render();
});

function pickSite(open) {
  const weights = open.map((s) => s.cmd);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < open.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return open[i];
  }
  return open[open.length - 1];
}

function tick() {
  if (!state.live || state.minutes >= 23 * 60 + 59) return;
  state.minutes += 1;
  const idx = hourIndex();
  const open = state.sites.filter((s) => !s.paused);
  if (open.length && Math.random() < 0.6) {
    let s = pickSite(open);
    if (s.id === 2 && s.rerouted && !site(1).paused) s = site(1);
    s.cmd += 1;
    s.cuisine = Math.min(8, s.cuisine + 1);
    state.hourly[s.id][idx] += 1;
    state.revenue += s.panier;
    if (Math.random() < 0.55) state.om += 1; else state.momo += 1;
    state.flash = s.id;
  }
  state.sites.forEach((s) => {
    if (s.cuisine > 1 && Math.random() < 0.35) s.cuisine -= 1;
    if (s.id === 2 && s.rerouted && s.late > 0 && Math.random() < 0.4) {
      s.late -= 1;
      s.attente = Math.max(15, s.attente - 5);
    }
  });
  render();
}

render();
setInterval(tick, TICK_MS);
