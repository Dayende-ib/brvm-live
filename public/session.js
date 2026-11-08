(() => {
  'use strict';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function link(href, className, text) {
    const node = el('a', className, text);
    node.href = href;
    return node;
  }

  function createUserMenu(session) {
    const user = session.utilisateur || {};
    const username = String(user.nom_utilisateur || '');
    const initial = username.slice(0, 1).toUpperCase() || '?';

    const menu = el('div', 'user-menu');
    menu.dataset.userMenu = '';

    const trigger = el('button', 'user-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'user-panel');

    trigger.append(
      el('span', 'avatar', initial),
      el('span', 'user-trigger-name', username),
      el('span', 'chevron', '▾')
    );
    trigger.querySelector('.chevron').setAttribute('aria-hidden', 'true');

    const panel = el('div', 'user-panel');
    panel.id = 'user-panel';
    panel.hidden = true;

    const meta = el('p', 'user-panel-meta');
    meta.append(document.createTextNode('Connecté en tant que'), el('br'), el('strong', '', username));

    const accountLink = link('/compte', 'user-panel-link', 'Mon compte');
    const favoritesCount = Array.isArray(session.favoris) ? session.favoris.length : 0;
    const favoritesLink = link(
      '/compte#favoris',
      'user-panel-link',
      favoritesCount > 0 ? `Mes favoris (${favoritesCount})` : 'Mes favoris'
    );

    const form = el('form', 'user-panel-form');
    form.method = 'post';
    form.action = '/deconnexion';

    const csrf = document.createElement('input');
    csrf.type = 'hidden';
    csrf.name = '_csrf';
    csrf.value = session.csrf_token || '';

    const logout = el('button', 'user-panel-link', 'Se déconnecter');
    logout.type = 'submit';

    form.append(csrf, logout);
    panel.append(meta, accountLink, favoritesLink, form);
    menu.append(trigger, panel);

    function close() {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', () => {
      const willOpen = panel.hidden;
      panel.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', String(willOpen));
    });

    document.addEventListener('click', (event) => {
      if (!menu.contains(event.target)) close();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        close();
        trigger.focus();
      }
    });

    return menu;
  }

  function createGuestActions() {
    const fragment = document.createDocumentFragment();
    fragment.append(
      link('/connexion', 'btn btn-ghost btn-sm', 'Connexion'),
      link('/inscription', 'btn btn-sm', 'Créer un compte')
    );
    return fragment;
  }

  function render(session) {
    const area = document.querySelector('[data-auth-area]');
    if (!area) return;

    area.replaceChildren(
      session && session.authentifie ? createUserMenu(session) : createGuestActions()
    );

    if (session && session.authentifie) {
      area.classList.add('is-authenticated');
    } else {
      area.classList.remove('is-authenticated');
    }
  }

  const ready = fetch('/api/session', {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin'
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((session) => {
      if (!session) return null;
      window.brvmSession = session;
      render(session);
      window.dispatchEvent(new CustomEvent('brvm:session', { detail: session }));
      return session;
    })
    .catch(() => null);

  window.brvmSessionReady = ready;
})();
