(() => {
  'use strict';

  const API_URL = '/api/cours';
  const REFRESH_MS = 60 * 1000;
  const NUMERIC_KEYS = new Set([
    'volume',
    'cours_veille',
    'ouverture',
    'cloture',
    'variation_pct'
  ]);

  const state = {
    actions: [],
    filtered: [],
    sortKey: 'symbole',
    sortDir: 'asc',
    loadedAt: null,
    loading: false,
    stale: false
  };

  const $ = (id) => document.getElementById(id);

  const numberFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
  const integerFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const timeFormatter = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit'
  });

  function normalize(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function formatNumber(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return numberFormatter.format(value);
  }

  function formatVolume(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return integerFormatter.format(value);
  }

  function formatVariation(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    const sign = value > 0 ? '+' : '';
    return `${sign}${numberFormatter.format(value)} %`;
  }

  function variationClass(value) {
    if (value === null || value === undefined || value === 0) return 'neutral';
    return value > 0 ? 'positive' : 'negative';
  }

  function setStatus(kind, text) {
    const status = $('status');
    status.dataset.state = kind;
    $('status-text').textContent = text;
  }

  function showAlert(message) {
    const alert = $('alert');
    alert.textContent = message;
    alert.hidden = false;
  }

  function hideAlert() {
    const alert = $('alert');
    alert.hidden = true;
    alert.textContent = '';
  }

  function createCard(label, value, detail) {
    const article = document.createElement('article');
    article.className = 'metric';

    const labelEl = document.createElement('p');
    labelEl.className = 'metric-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('p');
    valueEl.className = 'metric-value';
    valueEl.textContent = value;

    const detailEl = document.createElement('p');
    detailEl.className = 'metric-detail';
    detailEl.textContent = detail;

    article.append(labelEl, valueEl, detailEl);
    return article;
  }

  function renderMetrics() {
    const container = $('metrics');
    const actions = state.actions;
    const hausses = actions.filter((action) => Number(action.variation_pct) > 0).length;
    const baisses = actions.filter((action) => Number(action.variation_pct) < 0).length;
    const volume = actions.reduce((sum, action) => sum + (Number(action.volume) || 0), 0);

    container.replaceChildren(
      createCard('Actions cotées', integerFormatter.format(actions.length), 'dans le tableau BRVM'),
      createCard('Hausses', integerFormatter.format(hausses), 'variation positive'),
      createCard('Baisses', integerFormatter.format(baisses), 'variation négative'),
      createCard('Volume total', integerFormatter.format(volume), 'titres échangés')
    );
  }

  function renderUpdated() {
    const label = $('updated');
    if (!state.loadedAt) {
      label.textContent = '—';
      return;
    }

    const ageSeconds = Math.max(0, Math.round((Date.now() - state.loadedAt) / 1000));
    let relative = "à l'instant";
    if (ageSeconds >= 60) relative = `il y a ${Math.floor(ageSeconds / 60)} min`;

    const stale = state.stale ? ' · données de secours' : '';
    label.textContent = `Dernière récupération : ${timeFormatter.format(new Date(state.loadedAt))} (${relative})${stale}`;
  }

  function createCell(text, className) {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    cell.textContent = text;
    return cell;
  }

  function createVariationCell(value) {
    const cell = document.createElement('td');
    cell.className = 'numeric';
    const badge = document.createElement('span');
    badge.className = `badge ${variationClass(value)}`;
    badge.textContent = formatVariation(value);
    cell.append(badge);
    return cell;
  }

  function sortActions(actions) {
    const { sortKey, sortDir } = state;
    const direction = sortDir === 'asc' ? 1 : -1;

    return actions.slice().sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];

      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;

      if (NUMERIC_KEYS.has(sortKey)) {
        return (Number(left) - Number(right)) * direction;
      }
      return String(left).localeCompare(String(right), 'fr') * direction;
    });
  }

  function renderRows() {
    const tbody = $('tbody');
    const fragment = document.createDocumentFragment();

    for (const action of state.filtered) {
      const row = document.createElement('tr');
      row.append(
        createCell(action.symbole, 'symbole'),
        createCell(action.nom, 'nom'),
        createCell(formatVolume(action.volume), 'numeric'),
        createCell(formatNumber(action.cours_veille), 'numeric'),
        createCell(formatNumber(action.ouverture), 'numeric'),
        createCell(formatNumber(action.cloture), 'numeric'),
        createVariationCell(action.variation_pct)
      );
      fragment.append(row);
    }

    tbody.replaceChildren(fragment);
  }

  function updateSortIndicators() {
    document.querySelectorAll('th[data-key]').forEach((th) => {
      const isActive = th.dataset.key === state.sortKey;
      if (isActive) {
        th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
      } else {
        th.removeAttribute('aria-sort');
      }

      const icon = th.querySelector('.sort-icon');
      if (icon) icon.textContent = isActive ? (state.sortDir === 'asc' ? '↑' : '↓') : '';
    });
  }

  function applyFilter() {
    const query = normalize($('search').value);
    state.filtered = state.actions.filter((action) => {
      if (!query) return true;
      return normalize(action.symbole).includes(query) || normalize(action.nom).includes(query);
    });
    state.filtered = sortActions(state.filtered);

    renderRows();
    updateSortIndicators();

    const count = state.filtered.length;
    $('result-count').textContent = query
      ? `${count} résultat${count > 1 ? 's' : ''} sur ${state.actions.length}`
      : `${state.actions.length} action${state.actions.length > 1 ? 's' : ''}`;
    $('empty').hidden = count !== 0;
    $('clear-search').hidden = !query;
  }

  function renderSkeleton() {
    const tbody = $('tbody');
    const fragment = document.createDocumentFragment();
    for (let row = 0; row < 8; row += 1) {
      const tr = document.createElement('tr');
      tr.className = 'skeleton-row';
      for (let cell = 0; cell < 7; cell += 1) {
        const td = document.createElement('td');
        const bar = document.createElement('span');
        bar.className = 'skeleton';
        td.append(bar);
        tr.append(td);
      }
      fragment.append(tr);
    }
    tbody.replaceChildren(fragment);
  }

  async function loadData({ silent = false } = {}) {
    if (state.loading) return;
    state.loading = true;

    $('refresh').disabled = true;
    $('table').setAttribute('aria-busy', 'true');
    if (!silent) setStatus('loading', 'Actualisation…');
    if (state.actions.length === 0) renderSkeleton();

    try {
      const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.erreur || `erreur HTTP ${response.status}`);
      }
      if (!data || !Array.isArray(data.actions)) {
        throw new Error('réponse inattendue du serveur');
      }

      state.actions = data.actions;
      state.loadedAt = Date.now();
      state.stale = Boolean(data.perime);

      hideAlert();
      renderMetrics();
      applyFilter();
      renderUpdated();
      setStatus(state.stale ? 'stale' : 'ok', state.stale ? 'Données de secours' : 'À jour');
    } catch (error) {
      showAlert(`Impossible de charger les cours : ${error.message}.`);
      setStatus('error', 'Hors ligne');
      if (state.actions.length === 0) {
        $('tbody').replaceChildren();
        $('empty').hidden = true;
      }
    } finally {
      state.loading = false;
      $('refresh').disabled = false;
      $('table').removeAttribute('aria-busy');
    }
  }

  async function loadVisits() {
    try {
      const response = await fetch('/api/visites', { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const data = await response.json();
      const today = data.aujourd_hui || { vues: 0, uniques: 0 };
      $('visits').textContent =
        `Aujourd’hui : ${integerFormatter.format(today.vues)} vue(s) · ` +
        `${integerFormatter.format(today.uniques)} visiteur(s) unique(s) — ` +
        `total ${integerFormatter.format(data.vues_total)} vues.`;
    } catch {
      $('visits').textContent = '';
    }
  }

  let searchTimer;
  $('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilter, 120);
  });

  $('search').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $('search').value = '';
      applyFilter();
    }
  });

  $('clear-search').addEventListener('click', () => {
    $('search').value = '';
    $('search').focus();
    applyFilter();
  });

  document.querySelectorAll('.sort').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.key;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = NUMERIC_KEYS.has(key) ? 'desc' : 'asc';
      }
      applyFilter();
    });
  });

  $('refresh').addEventListener('click', () => loadData());

  setInterval(() => {
    if (document.visibilityState === 'visible') loadData({ silent: true });
  }, REFRESH_MS);

  setInterval(renderUpdated, 30 * 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.loadedAt) {
      const age = Date.now() - state.loadedAt;
      if (age > REFRESH_MS) loadData({ silent: true });
    }
  });

  renderSkeleton();
  setStatus('loading', 'Chargement…');
  loadData();
  loadVisits();
})();
