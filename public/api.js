(() => {
  'use strict';

  const PLACEHOLDER = 'https://votre-domaine.tld';
  const origin = window.location.origin;
  const status = document.getElementById('copy-status');

  if (origin && origin !== 'null') {
    document.querySelectorAll('code').forEach((code) => {
      if (code.textContent.includes(PLACEHOLDER)) {
        code.textContent = code.textContent.split(PLACEHOLDER).join(origin);
      }
    });
  }

  function announce(message) {
    if (!status) return;
    status.textContent = message;
  }

  function feedback(button, label) {
    const original = button.dataset.originalLabel || button.textContent;
    button.dataset.originalLabel = original;
    button.textContent = label;
    button.disabled = true;
    window.setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1800);
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      return document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
  }

  document.querySelectorAll('.copy-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset.copy);
      if (!target) return;

      try {
        const copied = await copyText(target.textContent);
        feedback(button, copied ? 'Copié !' : 'Échec');
        announce(copied ? 'Exemple copié dans le presse-papiers.' : 'Copie impossible, sélectionnez le texte manuellement.');
      } catch {
        feedback(button, 'Échec');
        announce('Copie impossible, sélectionnez le texte manuellement.');
      }
    });
  });
})();
