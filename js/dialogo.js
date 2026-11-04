// Chrome < 84 não aplica "gap" em flex: o CSS usa margens no lugar (classe sem-gap).
(() => {
  const d = document.createElement('div');
  d.style.cssText = 'display:flex;flex-direction:column;gap:1px;position:absolute;visibility:hidden';
  d.appendChild(document.createElement('div')); d.appendChild(document.createElement('div'));
  document.body.appendChild(d);
  if (d.scrollHeight !== 1) document.documentElement.classList.add('sem-gap');
  d.remove();
})();

// Janelas <dialog> em navegadores antigos (Safari < 15.4, Samsung Internet e WebViews antigos),
// que não têm showModal(): imita showModal, close, returnValue, o evento "close" e o envio
// de <form method="dialog">.
(() => {
  if (typeof HTMLDialogElement === 'function' && 'showModal' in HTMLDialogElement.prototype) return;
  document.documentElement.classList.add('sem-dialog');

  let fundo;
  function preparar(dlg) {
    dlg.returnValue = '';
    dlg.showModal = dlg.show = () => {
      if (dlg.hasAttribute('open')) return;
      if (!fundo) { fundo = document.createElement('div'); fundo.className = 'dialog-fundo'; document.body.appendChild(fundo); }
      fundo.hidden = false;
      dlg.returnValue = '';
      dlg.setAttribute('open', '');
    };
    dlg.close = valor => {
      if (!dlg.hasAttribute('open')) return;
      if (valor !== undefined) dlg.returnValue = valor;
      dlg.removeAttribute('open');
      if (!document.querySelector('dialog[open]') && fundo) fundo.hidden = true;
      dlg.dispatchEvent(new Event('close'));
    };
    Object.defineProperty(dlg, 'open', { get: () => dlg.hasAttribute('open') });

    // <form method="dialog">: o botão clicado define returnValue e fecha.
    let botao = null;
    dlg.addEventListener('click', e => { botao = e.target.closest('button'); }, true);
    const form = dlg.querySelector('form[method="dialog"]');
    if (form) form.addEventListener('submit', e => {
      e.preventDefault();
      dlg.close(botao && botao.form === form && botao.value ? botao.value : '');
    });
  }
  document.querySelectorAll('dialog').forEach(preparar);
})();

// Erros inesperados aparecem na tela, para o usuário poder relatar.
(() => {
  const mostrar = msg => {
    const el = document.getElementById('aviso');
    if (!el) return;
    el.textContent = 'Erro: ' + msg;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 10000);
  };
  window.addEventListener('error', e => mostrar(e.message || String(e.error)));
  window.addEventListener('unhandledrejection', e => mostrar((e.reason && e.reason.message) || String(e.reason)));
})();
