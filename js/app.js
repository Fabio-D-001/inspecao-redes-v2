const TIPOS = [
  'Subestação',
  'Estado de conservação da Subestação',
  'Vegetação em contato com a rede',
  'Postes danificados',
  'Postes fora de prumo ou fletido',
  'Para-raios atuados ou ausentes',
  'Redes com condutores desnivelados',
  'Rede fora do espaçador ou do isolador',
  'Cruzetas danificadas',
  'Cruzetas Giradas ou fora da bissetriz',
  'Ausência de distanciamento mínimo',
  'Transformador com vazamento ou merejamento de óleo',
  'Transformador com oxidação ou corrosão',
  'Instalações e equipamentos sem uso/inativos',
  'Ausência de aterramento',
  'Cabo neutro cortado/ausente',
  'Outras constatações',
];

const $ = id => document.getElementById(id);
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const fmt = Relatorio.formatarDataHora;
// Registros antigos não guardavam o alimentador: usam o da inspeção.
const alimDe = reg => reg.alimentador || estado.inspecao.alimentador;

const estado = {
  inspecao: null,      // inspeção aberta
  registro: null,      // registro em edição (null = novo)
  foto: null,          // { blob, largura, altura }
  coordsManual: false, // usuário escolheu no mapa ou digitou: o GPS não sobrescreve
  gpsWatch: null,
  urls: [],            // object URLs das miniaturas, liberadas ao redesenhar
  redes: [],           // redes (BDGD) da inspeção aberta: [{ distribuidora, circuito, extra, d }], d = dados ou null
  redesDe: null,       // id da inspeção a que estado.redes se refere
  redesCarregando: false,
  nRegistros: 0,
};

/* ------------------------------ utilidades ------------------------------ */

let avisoTimer;
function avisar(msg, ms = 3500) {
  const el = $('aviso');
  el.textContent = msg; el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function lerDataHora(txt) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(txt.trim());
  if (!m) return null;
  const [, d, mo, a, h, mi, s] = m.map(Number);
  const dt = new Date(a, mo - 1, d, h, mi, s);
  if (dt.getDate() !== d || dt.getMonth() !== mo - 1 || h > 23 || mi > 59 || s > 59) return null;
  return dt.getTime();
}

// Máscara dd/mm/aaaa hh:mm:ss enquanto digita.
$('fData').addEventListener('input', e => {
  const dig = e.target.value.replace(/\D/g, '').slice(0, 14);
  const partes = [dig.slice(0, 2), dig.slice(2, 4), dig.slice(4, 8), dig.slice(8, 10), dig.slice(10, 12), dig.slice(12, 14)];
  const seps = ['', '/', '/', ' ', ':', ':'];
  let out = '';
  partes.forEach((p, i) => { if (p) out += (i ? seps[i] : '') + p; });
  e.target.value = out;
});

const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const numero = txt => {
  const v = parseFloat(String(txt).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

// Versão de teste publicada como artefato do claude.ai: sem GPS, mapa, compartilhamento
// nem modo offline; arquivos saem pelo "downloads" do artefato.
const MODO_ARTEFATO = !!window.MODO_ARTEFATO;
let downloadsArtefato = null;
if (MODO_ARTEFATO && window.claude) window.claude.use('downloads').then(d => { downloadsArtefato = d; });

async function baixar(blob, nome) {
  if (MODO_ARTEFATO) {
    if (!downloadsArtefato) { avisar('Salvar arquivos não está disponível nesta visualização.', 6000); return false; }
    try { await downloadsArtefato.save({ filename: nome, data: blob }); return true; }
    catch (e) { if (e.code !== 'declined') avisar('Não foi possível salvar: ' + e.message, 6000); return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return true;
}

// Confirmação dentro da página (o confirm() do navegador não aparece em todos os lugares).
function confirmar(mensagem, botao = 'Excluir') {
  const dlg = $('dlgConfirmar');
  $('dlgConfirmarTexto').textContent = mensagem;
  $('dlgConfirmarOk').textContent = botao;
  dlg.showModal();
  return new Promise(ok => dlg.addEventListener('close', () => ok(dlg.returnValue === 'ok'), { once: true }));
}

async function comprimirFoto(arquivo) {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const MAX = 2400; // guardada em alta; o relatório reduz conforme a qualidade da inspeção
    const f = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const largura = Math.round(img.naturalWidth * f), altura = Math.round(img.naturalHeight * f);
    const cv = document.createElement('canvas');
    cv.width = largura; cv.height = altura;
    cv.getContext('2d').drawImage(img, 0, 0, largura, altura);
    const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.88));
    return { blob, largura, altura };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------ navegação ------------------------------ */

const TELAS = ['telaInicio', 'telaInspecao', 'telaRegistro', 'telaArquivos'];
function mostrar(tela, titulo) {
  TELAS.forEach(t => { $(t).hidden = t !== tela; });
  $('titulo').textContent = titulo;
  $('btnVoltar').hidden = tela === 'telaInicio';
  if (tela !== 'telaRegistro') pararGps();
  window.scrollTo(0, 0);
}

// O botão "voltar" do Android passa pelo histórico.
function ir(tela, dados = {}) { history.pushState({ tela, ...dados }, ''); }
window.addEventListener('popstate', e => abrirPorEstado(e.state));
$('btnVoltar').addEventListener('click', () => history.back());

async function abrirPorEstado(s) {
  if (!s || s.tela === 'telaInicio') return telaInicio();
  if (s.tela === 'telaInspecao') return telaInspecao(s.inspecaoId);
  if (s.tela === 'telaArquivos') return telaArquivos();
  if (s.tela === 'telaRegistro') {
    if (!estado.inspecao) return telaInicio();
    return telaRegistro(s.registroId || null);
  }
}

/* ------------------------------ tela inicial ------------------------------ */

async function telaInicio() {
  estado.inspecao = null;
  mostrar('telaInicio', 'Inspeção de Redes 2.0');
  const insps = (await DB.todos('inspecoes')).sort((a, b) => b.criadaEm - a.criadaEm);
  const regs = await DB.todos('registros');
  const ul = $('listaInspecoes');
  ul.innerHTML = '';
  $('semInspecoes').hidden = insps.length > 0;
  for (const i of insps) {
    const n = regs.filter(r => r.inspecaoId === i.id).length;
    const li = document.createElement('li');
    li.innerHTML = `<div class="info"><strong></strong><small></small></div><span>&#8250;</span>`;
    li.querySelector('strong').textContent = `Alim. ${i.alimentador}`;
    li.querySelector('small').textContent = (i.distribuidora ? `${i.distribuidora.nome} · ` : '') +
      `Iniciada em ${fmt(i.criadaEm)} · ${n} ${n === 1 ? 'registro' : 'registros'}`;
    li.addEventListener('click', () => { ir('telaInspecao', { inspecaoId: i.id }); telaInspecao(i.id); });
    ul.appendChild(li);
  }
}

const QUALIDADES = Relatorio.QUALIDADES;
const qualidadeDe = insp => (QUALIDADES[insp.qualidade] ? insp.qualidade : 'media');
$('dlgQualidade').append(...Object.entries(QUALIDADES).map(([v, q]) => new Option(q.rotulo, v)));
// Quantos registros com foto cabem num relatório que ainda dá para enviar por e-mail.
const maxRegistros = q => `máx. ~${q.maxRegistros} registros com foto (relatório de até ${Relatorio.LIMITE_MB} MB, para e-mail)`;
const dicaQualidade = () => {
  const q = QUALIDADES[$('dlgQualidade').value];
  $('dlgQualidadeDica').textContent = `${q.dica}; ${maxRegistros(q)}.`;
};
$('dlgQualidade').addEventListener('change', dicaQualidade);

// Distribuidora e alimentador: a lista vem da BDGD da ANEEL (pasta dados/). Sem internet e sem a lista
// guardada, o alimentador pode ser digitado; nesse caso a rede não aparece no mapa.
const escolha = { lista: null, alim: null, avisouFora: false, soRede: false };

async function prepararDistribuidoras() {
  const sel = $('dlgDist');
  if (sel.options.length > 1) return;
  sel.replaceChildren(new Option('Carregando…', ''));
  try {
    const idx = await Rede.distribuidoras();
    sel.replaceChildren(new Option('Selecione…', ''), ...idx.distribuidoras.map(d => new Option(d.nome, d.id)));
  } catch (e) {
    sel.replaceChildren(new Option('Lista indisponível (sem internet)', ''));
  }
}

const dicaAlim = (txt, classe = '') => { $('dlgAlimDica').textContent = txt; $('dlgAlimDica').className = 'dica ' + classe; };
const descreverAlim = a => [a.cod !== a.nome ? a.cod : '', a.subNome || a.sub ? `SE ${a.subNome || a.sub}` : '',
  `${a.trafos} ${a.trafos === 1 ? 'transformador' : 'transformadores'}`].filter(Boolean).join(' · ');

async function carregarListaAlims() {
  const id = $('dlgDist').value;
  escolha.lista = null;
  escolha.alim = null;
  mostrarSugestoes(false);
  if (!id) { dicaAlim($('dlgDist').options.length > 1 ? 'Escolha a distribuidora para ver a lista de alimentadores.' : ''); return; }
  dicaAlim('Carregando a lista de alimentadores…');
  try {
    const lista = await Rede.alimentadores(id);
    if ($('dlgDist').value !== id) return;
    escolha.lista = lista;
    escolherDigitado();
    if (!escolha.alim) dicaAlim(`${lista.length} alimentadores na base da ANEEL. Digite para filtrar e toque no alimentador.`);
  } catch (e) {
    if ($('dlgDist').value !== id) return;
    dicaAlim('Sem internet: a lista de alimentadores não está disponível. Digite o nome; a rede só aparece no mapa se o alimentador for escolhido da lista.', 'busca');
  }
}

// Se o texto digitado é exatamente um alimentador da lista, considera-o escolhido.
function escolherDigitado() {
  const v = $('dlgAlimInput').value.trim();
  escolha.alim = (v && escolha.lista && escolha.lista.find(a => Rede.igual(v, a.nome) || Rede.igual(v, a.cod))) || null;
  if (escolha.alim) dicaAlim(`Alimentador da base da ANEEL: ${descreverAlim(escolha.alim)}.`, 'ok');
}

function mostrarSugestoes(mostrar = true) {
  const ul = $('dlgAlimLista');
  ul.hidden = !mostrar || !escolha.lista;
  if (ul.hidden) return;
  const achados = Rede.filtrar(escolha.lista, $('dlgAlimInput').value);
  ul.replaceChildren(...achados.map((a, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<strong></strong><small></small>';
    li.querySelector('strong').textContent = a.nome;
    li.querySelector('small').textContent = descreverAlim(a);
    if (i === 0) li.className = 'ativo';
    // mousedown/touch antes do blur do campo, para o toque não se perder
    li.addEventListener('mousedown', e => e.preventDefault());
    li.addEventListener('click', () => selecionarAlim(a));
    return li;
  }));
  if (!achados.length) {
    const li = document.createElement('li');
    li.className = 'vazio';
    li.textContent = 'Nenhum alimentador com esse nome nesta distribuidora.';
    ul.appendChild(li);
  }
}

function selecionarAlim(a) {
  $('dlgAlimInput').value = Rede.rotulo(a);
  escolha.alim = a;
  mostrarSugestoes(false);
  dicaAlim(`Alimentador da base da ANEEL: ${descreverAlim(a)}.`, 'ok');
}

$('dlgDist').addEventListener('change', carregarListaAlims);
$('dlgAlimInput').addEventListener('input', () => {
  escolha.alim = null;
  escolha.avisouFora = false;
  escolherDigitado();
  if (!escolha.alim && escolha.lista) dicaAlim('');
  mostrarSugestoes();
});
$('dlgAlimInput').addEventListener('focus', () => { if (!escolha.alim) mostrarSugestoes(); });
$('dlgAlimInput').addEventListener('blur', () => setTimeout(() => mostrarSugestoes(false), 150));
$('dlgAlimInput').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const primeiro = !$('dlgAlimLista').hidden && escolha.lista && Rede.filtrar(escolha.lista, $('dlgAlimInput').value, 1)[0];
  if (primeiro) selecionarAlim(primeiro); else $('dlgAlimOk').click();
});

$('dlgAlimOk').addEventListener('click', () => {
  const v = $('dlgAlimInput').value.trim();
  const temLista = $('dlgDist').options.length > 1;
  if (temLista && !$('dlgDist').value) { dicaAlim('Escolha a distribuidora.', 'erro'); $('dlgDist').focus(); return; }
  if (!v) { dicaAlim('Informe o alimentador.', 'erro'); $('dlgAlimInput').focus(); return; }
  escolherDigitado();
  if (escolha.soRede && !escolha.alim) {
    dicaAlim(escolha.lista ? 'Escolha um alimentador da lista: só assim a rede pode ser carregada.'
      : 'Sem a lista de alimentadores (sem internet) não dá para carregar outra rede agora.', 'erro');
    return;
  }
  if (!escolha.alim && escolha.lista && !escolha.avisouFora) {
    escolha.avisouFora = true;
    dicaAlim('Este alimentador não está na lista da ANEEL, então a rede não aparecerá no mapa. Toque de novo para continuar assim, ou escolha um da lista.', 'erro');
    return;
  }
  $('dlgAlim').close('ok');
});

// Pergunta distribuidora, alimentador e qualidade das fotos; devolve os dados da inspeção ou null.
// Com "soRede", só escolhe um alimentador da lista (para carregar a rede dele) e não pergunta a qualidade.
function perguntarInspecao(titulo, { alimentador = '', qualidade = 'media', distribuidora = null, circuito = null, soRede = false } = {}, botao = 'Iniciar') {
  const dlg = $('dlgAlim');
  escolha.soRede = soRede;
  $('dlgBlocoQualidade').hidden = soRede;
  $('dlgAlimTitulo').textContent = titulo;
  $('dlgAlimOk').textContent = botao;
  $('dlgAlimInput').value = alimentador;
  $('dlgQualidade').value = qualidade;
  dicaQualidade();
  dicaAlim('');
  escolha.avisouFora = false;
  mostrarSugestoes(false);
  dlg.showModal();
  prepararDistribuidoras().then(() => {
    const sel = $('dlgDist');
    if (distribuidora && ![...sel.options].some(o => o.value === distribuidora.id)) sel.append(new Option(distribuidora.nome, distribuidora.id));
    sel.value = distribuidora ? distribuidora.id : '';
    return carregarListaAlims();
  }).then(() => {
    if (circuito && escolha.lista) {
      const a = escolha.lista.find(x => x.arq === circuito.arq);
      if (a && Rede.igual($('dlgAlimInput').value, Rede.rotulo(a))) selecionarAlim(a);
    }
  });
  if (!alimentador) setTimeout(() => ($('dlgDist').value ? $('dlgAlimInput') : $('dlgDist')).focus(), 50);
  return new Promise(ok => {
    dlg.addEventListener('close', () => {
      mostrarSugestoes(false);
      const v = $('dlgAlimInput').value.trim();
      if (dlg.returnValue !== 'ok' || !v) return ok(null);
      const sel = $('dlgDist');
      const a = escolha.alim;
      ok({
        alimentador: v,
        qualidade: $('dlgQualidade').value,
        distribuidora: sel.value ? { id: sel.value, nome: sel.options[sel.selectedIndex].text } : distribuidora,
        circuito: a ? { cod: a.cod, nome: a.nome, sub: a.sub, subNome: a.subNome, arq: a.arq } : null,
      });
    }, { once: true });
  });
}

$('btnNovaInspecao').addEventListener('click', async () => {
  const dados = await perguntarInspecao('Nova inspeção');
  if (!dados) return;
  const insp = { id: novoId(), ...dados, criadaEm: Date.now() };
  await DB.salvar('inspecoes', insp);
  if (insp.circuito) Rede.dados(insp.distribuidora.id, insp.circuito.arq).catch(() => {}); // já guarda para uso offline
  sincronizar(insp.id);
  ir('telaInspecao', { inspecaoId: insp.id });
  telaInspecao(insp.id);
});

/* ------------------------------ tela da inspeção ------------------------------ */

async function registrosOrdenados(inspecaoId) {
  return (await DB.registrosDe(inspecaoId)).sort((a, b) => a.dataHora - b.dataHora);
}

// Alimentadores cuja rede a inspeção mostra: o da inspeção e os acrescentados com "+ Alimentador" no mapa.
const circuitosDe = insp => [].concat(
  insp.circuito && insp.distribuidora ? [{ distribuidora: insp.distribuidora, circuito: insp.circuito, extra: false }] : [],
  (insp.redesExtras || []).map(r => ({ distribuidora: r.distribuidora, circuito: r.circuito, extra: true })));
const chaveDe = r => `${r.distribuidora.id}/${r.circuito.arq}`;
const ocultas = () => (estado.inspecao && estado.inspecao.redesOcultas) || [];
const carregadas = () => estado.redes.filter(r => r.d);
// Redes que aparecem nos mapas: as carregadas que não foram desligadas no botão de camadas.
const redesNoMapa = () => carregadas().filter(r => !ocultas().includes(chaveDe(r))).map(r => r.d);
const atualizarBotaoMapa = () => {
  $('btnMapaInsp').disabled = !estado.nRegistros && !carregadas().length && !(estado.inspecao && estado.inspecao.distribuidora);
};

// Carrega as redes (com internet, ou da cópia guardada pelo app). As já carregadas continuam no mapa.
async function carregarRede(insp) {
  const antes = estado.redesDe === insp.id ? estado.redes : [];
  estado.redesDe = insp.id;
  estado.redes = MODO_ARTEFATO ? [] : circuitosDe(insp).map(r => {
    const ja = antes.find(x => x.d && chaveDe(x) === chaveDe(r));
    return { ...r, d: ja ? ja.d : null };
  });
  estado.redesCarregando = estado.redes.some(r => !r.d);
  desenharRedes();
  if (!estado.redesCarregando) return;
  const res = await Promise.all(estado.redes.map(r => (r.d ? Promise.resolve(r) : Rede.dados(r.distribuidora.id, r.circuito.arq)
    .then(d => ({ ...r, d }), () => ({ ...r, d: null })))));
  if (!estado.inspecao || estado.inspecao.id !== insp.id || estado.redesDe !== insp.id) return;
  estado.redes = res;
  estado.redesCarregando = false;
  desenharRedes();
}
addEventListener('online', () => {
  if (estado.inspecao && estado.redes.some(r => !r.d) && !$('telaInspecao').hidden) carregarRede(estado.inspecao);
});

// Situação da rede na tela da inspeção; com o mapa aberto, atualiza as camadas.
function desenharRedes() {
  const insp = estado.inspecao;
  const st = $('redeStatus');
  const status = (txt, classe = '') => { st.textContent = txt; st.className = 'rede-status ' + classe; st.hidden = !txt; };
  const prontas = carregadas();
  const falhas = estado.redes.length - prontas.length;
  if (MODO_ARTEFATO || !insp.distribuidora) status('');
  else if (estado.redesCarregando) status('Carregando a rede…');
  else if (!estado.redes.length) status(insp.circuito ? '' : 'Alimentador fora da lista da ANEEL. No mapa, “+ Alimentador” carrega a rede de outro.');
  else if (prontas.length && !redesNoMapa().length) status('Rede desligada no botão de camadas do mapa.')
  else if (!prontas.length) status(navigator.onLine ? 'Não foi possível carregar a rede.' : 'Sem internet: a rede aparece no mapa quando houver conexão.', 'erro');
  else {
    const extras = prontas.filter(r => r.extra).length;
    status(`Rede no mapa (BDGD/ANEEL)${extras ? `, com mais ${extras} ${extras === 1 ? 'alimentador' : 'alimentadores'}` : ''}.` +
      (falhas ? ` ${falhas === 1 ? 'Uma rede não carregou' : `${falhas} redes não carregaram`}.` : ''), falhas ? 'erro' : 'ok');
  }
  atualizarBotaoMapa();
  if (mapa && !$('modalMapa').hidden) prepararMapa();
}

async function salvarInspecao(campos) {
  const insp = { ...(await DB.obter('inspecoes', estado.inspecao.id)), ...campos };
  await DB.salvar('inspecoes', insp);
  estado.inspecao = insp;
  return insp;
}

// "+ Alimentador" no mapa: carrega a rede de outro alimentador (até de outra distribuidora).
async function adicionarRede() {
  const i = estado.inspecao;
  const dados = await perguntarInspecao('Rede de outro alimentador', { distribuidora: i.distribuidora || null, soRede: true }, 'Carregar rede');
  if (!dados || !dados.circuito) return;
  const novo = { distribuidora: dados.distribuidora, circuito: dados.circuito };
  const k = chaveDe(novo);
  if (circuitosDe(estado.inspecao).some(r => chaveDe(r) === k)) {
    if (ocultas().includes(k)) { await salvarInspecao({ redesOcultas: ocultas().filter(c => c !== k) }); redeMapa.chave = null; desenharRedes(); }
    avisar('A rede deste alimentador já está no mapa.');
    return;
  }
  avisar('Carregando a rede…', 10000);
  await carregarRede(await salvarInspecao({ redesExtras: (estado.inspecao.redesExtras || []).concat([novo]) }));
  const r = estado.redes.find(x => chaveDe(x) === k);
  if (r && r.d) {
    if (mapa && !$('modalMapa').hidden) mapa.fitBounds(Rede.limites(r.d), { padding: [20, 20] });
    avisar(`Rede do alimentador ${Rede.rotulo(r.circuito)} no mapa.`);
  } else avisar(navigator.onLine ? 'Não foi possível carregar a rede desse alimentador.' : 'Sem internet: a rede desse alimentador aparece quando houver conexão.', 6000);
}

async function tirarRede(k) {
  await salvarInspecao({ redesExtras: (estado.inspecao.redesExtras || []).filter(x => chaveDe(x) !== k),
    redesOcultas: ocultas().filter(c => c !== k) });
  estado.redes = estado.redes.filter(x => chaveDe(x) !== k);
  desenharRedes();
}

async function telaInspecao(id) {
  const insp = await DB.obter('inspecoes', id);
  if (!insp) return telaInicio();
  estado.inspecao = insp;
  mostrar('telaInspecao', `Alim. ${insp.alimentador}`);
  $('distAtual').textContent = insp.distribuidora ? insp.distribuidora.nome : '';
  $('distAtual').hidden = !insp.distribuidora;
  $('alimAtual').textContent = insp.alimentador;
  if (estado.redesDe !== insp.id) carregarRede(insp); else desenharRedes();

  estado.urls.forEach(URL.revokeObjectURL);
  estado.urls = [];
  const regs = await registrosOrdenados(id);
  $('tituloRegistros').textContent = `Registros (${regs.length})`;
  $('semRegistros').hidden = regs.length > 0;
  ['btnDocx', 'btnPdf'].forEach(b => { $(b).disabled = regs.length === 0; });
  estado.nRegistros = regs.length;
  atualizarBotaoMapa();
  const q = QUALIDADES[qualidadeDe(insp)];
  const comFoto = regs.filter(r => r.foto).length;
  $('qualidadeAtual').textContent = `Fotos no relatório: qualidade ${q.rotulo.toLowerCase()} · ${maxRegistros(q)}` +
    (comFoto > q.maxRegistros ? `. Esta inspeção já tem ${comFoto}: use uma qualidade menor para enviar por e-mail.` : '');
  $('qualidadeAtual').className = comFoto > q.maxRegistros ? 'erro-texto' : '';

  const ul = $('listaRegistros');
  ul.innerHTML = '';
  regs.forEach((r, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num">${i + 1}</span>${r.foto ? '<img alt="">' : '<span class="sem-foto">sem foto</span>'}` +
      '<div class="info"><strong></strong><small></small><small></small></div>';
    if (r.foto) {
      const url = URL.createObjectURL(r.foto);
      estado.urls.push(url);
      li.querySelector('img').src = url;
    }
    li.querySelector('strong').textContent = r.tipo;
    const [s1, s2] = li.querySelectorAll('small');
    s1.textContent = r.descricao || '—';
    s2.textContent = `${fmt(r.dataHora)} · ${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}`;
    if (alimDe(r) !== insp.alimentador) s1.textContent = `Alim. ${alimDe(r)} · ${s1.textContent}`;
    li.addEventListener('click', () => { ir('telaRegistro', { registroId: r.id }); telaRegistro(r.id); });
    ul.appendChild(li);
  });
}

$('btnEditarAlim').addEventListener('click', async () => {
  const id = estado.inspecao.id;
  const i = estado.inspecao;
  const dados = await perguntarInspecao('Dados da inspeção',
    { alimentador: i.alimentador, qualidade: qualidadeDe(i), distribuidora: i.distribuidora || null, circuito: i.circuito || null }, 'Salvar');
  if (!dados) return;
  // Registros que seguiam o alimentador da inspeção acompanham a mudança; os alterados à mão ficam como estão.
  const antigo = estado.inspecao.alimentador;
  if (dados.alimentador !== antigo)
    for (const r of await DB.registrosDe(id))
      if (!r.alimentador || r.alimentador === antigo) await DB.salvar('registros', { ...r, alimentador: dados.alimentador, versao: Date.now() });
  await DB.salvar('inspecoes', { ...(await DB.obter('inspecoes', id)), ...dados });
  sincronizar(id);
  estado.redesDe = null; // recarrega a rede, que pode ter mudado
  estado.inspecao = null;
  telaInspecao(id);
});

$('btnNovoRegistro').addEventListener('click', () => { ir('telaRegistro'); telaRegistro(null); });

$('btnExcluirInsp').addEventListener('click', async () => {
  if (!await confirmar(`Excluir a inspeção do alimentador ${estado.inspecao.alimentador} e todos os seus registros e fotos? Os relatórios já gerados continuam na pasta Relatórios. Isso não pode ser desfeito.`)) return;
  const insp = await DB.obter('inspecoes', estado.inspecao.id);
  await DB.excluirInspecao(insp.id);
  await removerPastasDe(insp);
  history.back();
});

async function gerar(tipo) {
  const regs = await registrosOrdenados(estado.inspecao.id);
  const botao = $(tipo === 'docx' ? 'btnDocx' : 'btnPdf');
  const rotulo = botao.textContent;
  botao.disabled = true; botao.textContent = 'Gerando…';
  try {
    const blob = tipo === 'docx'
      ? await Relatorio.gerarDocx(estado.inspecao, regs, TIPOS)
      : await Relatorio.gerarPdf(estado.inspecao, regs, TIPOS);
    const arquivo = new File([blob], Relatorio.nomeArquivo(estado.inspecao.alimentador, tipo), { type: blob.type || (tipo === 'pdf' ? 'application/pdf' : '') });
    const arquivos = [arquivo];
    // Junto com o relatório, o .kmz com a rede carregada e os registros (abre no Google Earth, My Maps, QGIS).
    try {
      const kmz = await Kmz.gerar(estado.inspecao, regs, estado.redes.filter(r => r.d).map(r => r.d));
      arquivos.push(new File([kmz], arquivo.name.replace('Relatorio_Fotografico_', 'Mapa_Inspecao_').replace(/\.\w+$/, '.kmz'), { type: Kmz.TIPO }));
    } catch (e) {
      console.error(e);
      avisar('O relatório foi gerado, mas não foi possível gerar o .kmz: ' + e.message, 6000);
    }
    let pastaInfo = '';
    if (Pastas.suportado) {
      try {
        for (const f of arquivos) await Pastas.gravar(`${Pastas.RELATORIOS}/${f.name}`, f);
        pastaInfo = 'Guardados na pasta Relatórios do app.';
      } catch (e) { console.error(e); pastaInfo = 'Não foi possível guardar na pasta Relatórios do app.'; }
    }
    const a = estado.inspecao.alimentador;
    oferecerArquivo(arquivos, {
      titulo: arquivos.length > 1 ? 'Relatório e mapa (.kmz) prontos' : 'Relatório pronto', pastaInfo,
      compartilhar: { title: `Relatório fotográfico - Alim. ${a}`, text: `Relatório fotográfico da inspeção do alimentador ${a}.` },
    });
  } catch (e) {
    console.error(e);
    avisar('Não foi possível gerar o relatório: ' + e.message, 6000);
  } finally {
    botao.disabled = false; botao.textContent = rotulo;
  }
}
// O compartilhamento precisa partir de um toque do usuário, por isso vem numa janela
// depois de preparar o arquivo (a geração pode demorar mais do que o navegador permite).
const mb = bytes => `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`;
let arquivoPronto = null;
const podeCompartilhar = files => !MODO_ARTEFATO && !!(navigator.canShare && navigator.canShare({ files }));
const TEXTO_SEM_COMPARTILHAR = $('semCompartilhar').textContent;
// "arquivos": um File ou uma lista (relatório + .kmz). Se o navegador não compartilha algum dos tipos
// (o .kmz, em alguns celulares), compartilha os outros e avisa para salvar esse.
function oferecerArquivo(arquivos, { titulo = 'Arquivo', pastaInfo = '', compartilhar = {}, aoExcluir = null } = {}) {
  arquivos = [].concat(arquivos);
  const compartilhaveis = podeCompartilhar(arquivos) ? arquivos : arquivos.filter(f => podeCompartilhar([f]));
  const fora = arquivos.filter(f => !compartilhaveis.includes(f));
  arquivoPronto = { arquivos, compartilhaveis, compartilhar, aoExcluir };
  $('dlgRelTitulo').textContent = titulo;
  $('dlgRelNome').textContent = arquivos.map(f => `${f.name} (${mb(f.size)})`).join('\n');
  $('dlgRelPasta').textContent = pastaInfo;
  $('dlgRelPasta').hidden = !pastaInfo;
  $('btnCompartilhar').hidden = !compartilhaveis.length;
  $('semCompartilhar').hidden = !fora.length;
  $('semCompartilhar').textContent = compartilhaveis.length
    ? `Este navegador não compartilha ${fora.map(f => f.name.split('.').pop()).map(e => `o .${e}`).join(' e ')}: use “Salvar em Downloads” para ele.`
    : TEXTO_SEM_COMPARTILHAR;
  $('btnSalvarRel').textContent = arquivos.length > 1 ? 'Salvar os arquivos em Downloads' : 'Salvar em Downloads';
  $('btnExcluirArq').hidden = !aoExcluir;
  $('dlgRelatorio').showModal();
}

$('btnCompartilhar').addEventListener('click', async () => {
  const { compartilhaveis, compartilhar } = arquivoPronto;
  try {
    await navigator.share({ files: compartilhaveis, title: compartilhar.title || compartilhaveis[0].name, ...(compartilhar.text ? { text: compartilhar.text } : {}) });
    if (compartilhaveis.length === arquivoPronto.arquivos.length) $('dlgRelatorio').close();
  } catch (e) {
    if (e.name !== 'AbortError') avisar('Não foi possível compartilhar: ' + e.message, 6000);
  }
});
$('btnSalvarRel').addEventListener('click', async () => {
  $('dlgRelatorio').close();
  let ok = true;
  for (const f of arquivoPronto.arquivos) ok = (await baixar(f, f.name)) && ok;
  if (ok) avisar(arquivoPronto.arquivos.length > 1 ? 'Arquivos salvos. Veja na pasta Downloads.' : 'Arquivo salvo. Veja na pasta Downloads.');
});
$('btnExcluirArq').addEventListener('click', async () => {
  $('dlgRelatorio').close();
  if (!await confirmar(`Excluir ${arquivoPronto.arquivos[0].name}?`)) return;
  await arquivoPronto.aoExcluir();
});
$('btnFecharRel').addEventListener('click', () => $('dlgRelatorio').close());

$('btnDocx').addEventListener('click', () => gerar('docx'));
$('btnPdf').addEventListener('click', () => gerar('pdf'));

/* ------------------------------ formulário do registro ------------------------------ */

$('fTipo').append(new Option('Selecione…', ''), ...TIPOS.map(t => new Option(t, t)));

function definirFoto(foto) {
  estado.foto = foto;
  const img = $('fPreview');
  if (img.src) URL.revokeObjectURL(img.src);
  if (foto) { img.src = URL.createObjectURL(foto.blob); img.hidden = false; }
  else { img.removeAttribute('src'); img.hidden = true; }
  $('btnRemoverFoto').hidden = !foto;
}

async function telaRegistro(id) {
  const reg = id ? await DB.obter('registros', id) : null;
  estado.registro = reg;
  mostrar('telaRegistro', reg ? 'Editar registro' : 'Novo registro');
  $('erroForm').hidden = true;
  $('fAlim').value = reg ? alimDe(reg) : estado.inspecao.alimentador;
  const usados = new Set([estado.inspecao.alimentador, ...(await DB.registrosDe(estado.inspecao.id)).map(alimDe)]);
  $('listaAlims').replaceChildren(...[...usados].map(a => new Option(a)));
  $('fTipo').value = reg ? reg.tipo : '';
  $('fDesc').value = reg ? reg.descricao : '';
  $('fData').value = fmt(reg ? reg.dataHora : Date.now());
  $('fLat').value = reg ? reg.lat.toFixed(6) : '';
  $('fLon').value = reg ? reg.lon.toFixed(6) : '';
  $('btnExcluirReg').hidden = !reg;
  definirFoto(reg ? { blob: reg.foto, largura: reg.fotoLargura, altura: reg.fotoAltura } : null);
  estado.coordsManual = !!reg;
  $('gpsInfo').textContent = reg && reg.precisao ? `Precisão do GPS no registro: ±${Math.round(reg.precisao)} m` : '';
  $('gpsInfo').className = 'dica';
  mostrarNoMiniMapa(reg ? reg.lat : null, reg ? reg.lon : null, reg ? reg.precisao : null);
  if (MODO_ARTEFATO) $('gpsInfo').textContent = reg ? $('gpsInfo').textContent : 'Versão de teste: digite as coordenadas (GPS e mapa só no app instalado).';
  else if (!reg) iniciarGps();
}

$('btnAgora').addEventListener('click', () => { $('fData').value = fmt(Date.now()); });

// GPS: acompanha a posição e fica com a leitura mais precisa, até chegar abaixo de PRECISAO_META.
const PRECISAO_META = 5; // metros
let melhorPrecisao = Infinity;
const metros = m => (m < 10 ? m.toFixed(1).replace('.', ',') : String(Math.round(m)));
const buscandoGps = () => estado.gpsWatch !== null && !estado.coordsManual;
function iniciarGps() {
  pararGps();
  if (!('geolocation' in navigator)) { $('gpsInfo').textContent = 'Este aparelho não oferece GPS ao navegador.'; return; }
  melhorPrecisao = Infinity;
  estado.coordsManual = false;
  $('gpsInfo').textContent = 'Buscando posição pelo GPS…';
  $('gpsInfo').className = 'dica';
  estado.gpsWatch = navigator.geolocation.watchPosition(pos => {
    if (estado.coordsManual) return;
    const { latitude, longitude, accuracy } = pos.coords;
    if (accuracy <= melhorPrecisao) {
      melhorPrecisao = accuracy;
      $('fLat').value = latitude.toFixed(6);
      $('fLon').value = longitude.toFixed(6);
      mostrarNoMiniMapa(latitude, longitude, accuracy);
    }
    if (melhorPrecisao < PRECISAO_META) {
      pararGps();
      $('gpsInfo').textContent = `GPS: precisão de ±${metros(melhorPrecisao)} m (meta de ${PRECISAO_META} m atingida).`;
      $('gpsInfo').className = 'dica ok';
    } else {
      $('gpsInfo').textContent = `Melhorando a precisão do GPS: ±${metros(melhorPrecisao)} m (meta: menos de ${PRECISAO_META} m). Fique parado, de preferência a céu aberto.`;
      $('gpsInfo').className = 'dica busca';
    }
  }, err => {
    if (err.code === 3 && Number.isFinite(melhorPrecisao)) return; // continua buscando com a melhor leitura até agora
    const msg = { 1: 'Permissão de localização negada. Libere nas configurações do navegador ou use o mapa.',
      2: 'Posição indisponível. Vá para céu aberto ou escolha no mapa.', 3: 'O GPS demorou a responder. Tente de novo ou use o mapa.' };
    $('gpsInfo').textContent = msg[err.code] || err.message;
    $('gpsInfo').className = 'dica';
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
}
function pararGps() {
  if (estado.gpsWatch !== null) navigator.geolocation.clearWatch(estado.gpsWatch);
  estado.gpsWatch = null;
}
$('btnGps').addEventListener('click', iniciarGps);
['fLat', 'fLon'].forEach(c => $(c).addEventListener('input', () => {
  estado.coordsManual = true;
  pararGps();
  mostrarNoMiniMapa(numero($('fLat').value), numero($('fLon').value), null);
  $('gpsInfo').textContent = 'Coordenadas digitadas manualmente.';
  $('gpsInfo').className = 'dica';
}));

$('btnRemoverFoto').addEventListener('click', () => definirFoto(null));

for (const campo of ['fCamera', 'fGaleria']) {
  $(campo).addEventListener('change', async e => {
    const arq = e.target.files[0];
    e.target.value = '';
    if (!arq) return;
    const salvar = document.querySelector('#formRegistro button[type=submit]');
    salvar.disabled = true; salvar.textContent = 'Processando foto…';
    try { definirFoto(await comprimirFoto(arq)); }
    catch (err) { console.error(err); avisar('Não foi possível ler esta imagem.'); }
    finally { salvar.disabled = false; salvar.textContent = 'Salvar registro'; }
  });
}

$('formRegistro').addEventListener('submit', async e => {
  e.preventDefault();
  const erros = [];
  const alimentador = $('fAlim').value.trim();
  const tipo = $('fTipo').value;
  const dataHora = lerDataHora($('fData').value);
  const lat = numero($('fLat').value), lon = numero($('fLon').value);
  if (!alimentador) erros.push('informe o alimentador');
  if (!tipo) erros.push('escolha o tipo de irregularidade');
  if (dataHora === null) erros.push('informe a data/hora no formato dd/mm/aaaa hh:mm:ss');
  if (lat === null || lat < -90 || lat > 90 || lon === null || lon < -180 || lon > 180) erros.push('informe a localização (latitude e longitude válidas)');
  if (erros.length) {
    $('erroForm').textContent = 'Falta: ' + erros.join('; ') + '.';
    $('erroForm').hidden = false;
    $('erroForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (estado.salvando) return;
  if (buscandoGps() && melhorPrecisao >= PRECISAO_META &&
      !await confirmar(`O GPS ainda está com precisão de ±${metros(melhorPrecisao)} m (meta: menos de ${PRECISAO_META} m). Salvar assim mesmo?`, 'Salvar assim')) return;
  estado.salvando = true;
  const antigo = estado.registro;
  const reg = {
    id: antigo ? antigo.id : novoId(),
    inspecaoId: estado.inspecao.id,
    alimentador,
    tipo,
    descricao: $('fDesc').value.trim(),
    dataHora, lat, lon,
    precisao: estado.coordsManual ? (antigo ? antigo.precisao : null) : (Number.isFinite(melhorPrecisao) ? melhorPrecisao : null),
    foto: estado.foto ? estado.foto.blob : null, // a foto é opcional
    fotoLargura: estado.foto ? estado.foto.largura : null,
    fotoAltura: estado.foto ? estado.foto.altura : null,
    versao: Date.now(),
  };
  try {
    await DB.salvar('registros', reg);
    sincronizar(reg.inspecaoId);
    avisar(antigo ? 'Registro atualizado.' : 'Registro salvo.');
    history.back();
  } catch (err) {
    console.error(err);
    avisar('Não foi possível salvar (memória do aparelho cheia?).', 6000);
  } finally {
    estado.salvando = false;
  }
});

$('btnExcluirReg').addEventListener('click', async () => {
  if (!await confirmar('Excluir este registro?')) return;
  await DB.excluir('registros', estado.registro.id);
  sincronizar(estado.registro.inspecaoId);
  history.back();
});

/* ------------------------------ mapa ------------------------------ */

function camadasBase(m) {
  const ruas = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  });
  const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Imagens © Esri',
  });
  ruas.addTo(m);
  return L.control.layers({ 'Ruas': ruas, 'Satélite': satelite }).addTo(m);
}

// Põe no mini-mapa as redes ligadas (redesNoMapa), trocando as anteriores, com o código dos equipamentos
// quando bem aproximado.
function aplicarRede(alvo, m, opcoes) {
  const redes = redesNoMapa();
  const chave = redes.map(d => `${d.dist}/${d.cod}`).join('|');
  if (alvo.chave === chave) return;
  if (alvo.tirarRotulos) alvo.tirarRotulos();
  alvo.itens.forEach(c => c.camada.remove());
  alvo.chave = chave;
  alvo.itens = redes.length ? Rede.camadas(m, redes, opcoes) : [];
  for (const c of alvo.itens) if (c.visivel) c.camada.addTo(m);
  alvo.tirarRotulos = alvo.itens.length ? Rede.rotulos(m, alvo.itens) : null;
}

// Mini-mapa do formulário: mostra o ponto do registro e o círculo de precisão do GPS.
let miniMapa, miniMarcador, miniCirculo;
const miniRede = { chave: null, itens: [] };
function mostrarNoMiniMapa(lat, lon, precisao) {
  const el = $('miniMapa');
  const ok = !MODO_ARTEFATO && window.L && lat !== null && lon !== null;
  el.hidden = $('miniMapaDica').hidden = !ok;
  if (!ok) return;
  const ll = L.latLng(lat, lon);
  if (!miniMapa) {
    miniMapa = L.map(el, { zoomControl: false, preferCanvas: true });
    camadasBase(miniMapa);
    miniMarcador = L.marker(ll).addTo(miniMapa);
    miniCirculo = L.circle(ll, { radius: 1, color: '#ea7501', weight: 1, fillOpacity: 0.15 }).addTo(miniMapa);
    miniMapa.on('click', () => $('btnMapa').click());
    miniMapa.setView(ll, 18);
  }
  aplicarRede(miniRede, miniMapa, { interativo: false,
    so: ['rede3', 'rede1', 'trafos', 'fusiveis', 'seccionadoras', 'religadores', 'reguladores', 'capacitores', 'sub'] });
  // segue as camadas escolhidas no mapa grande
  for (const c of miniRede.itens) {
    if (!Rede.visivelChave(c.chave)) c.camada.remove();
    else if (!miniMapa.hasLayer(c.camada)) c.camada.addTo(miniMapa);
  }
  miniMapa.invalidateSize();
  miniMarcador.setLatLng(ll);
  miniCirculo.setLatLng(ll).setRadius(precisao > 0 ? precisao : 0);
  if (miniMapa.getZoom() < 16) miniMapa.setView(ll, 18); else miniMapa.panTo(ll);
}

let mapa, marcador, camadaPontos, pontoEscolhido, controleMapa;
// Mapa grande: no botão de camadas, cada alimentador é uma camada (liga/desliga a rede dele) e cada tipo
// de equipamento também (vale para todos os alimentadores). Por baixo, há um grupo por alimentador e tipo.
const redeMapa = { chave: null, redes: [], tipos: [], tirarRotulos: null };
let escolhendoPonto = false;

function rotuloAlim(r) {
  const nome = `<span class="leg-alim">Alim. ${esc(Rede.rotulo(r.circuito))}</span>`;
  const dist = r.distribuidora.id !== estado.inspecao.distribuidora.id ? ` <small>${esc(r.distribuidora.nome)}</small>` : '';
  return nome + dist + (r.extra ? ` <a href="#" class="tirar-rede" data-chave="${esc(chaveDe(r))}">tirar</a>` : ' <small>(da inspeção)</small>');
}

function aplicarRedeMapa() {
  const lista = carregadas();
  const chave = lista.map(chaveDe).join('|');
  if (redeMapa.chave === chave) return;
  if (redeMapa.tirarRotulos) redeMapa.tirarRotulos();
  redeMapa.redes.forEach(x => { controleMapa.removeLayer(x.grupo); x.grupo.remove(); });
  redeMapa.tipos.forEach(t => { controleMapa.removeLayer(t.liga); t.liga.remove(); });
  if (redeMapa.titulos) redeMapa.titulos.forEach(t => t.remove());
  redeMapa.chave = chave;
  const tipos = {};
  redeMapa.redes = lista.map(r => {
    const subs = Rede.camadas(mapa, [r.d], { aoTocar: mostrarEquipamento });
    const grupo = L.layerGroup();
    for (const c of subs) {
      const t = tipos[c.chave] || (tipos[c.chave] = { chave: c.chave, base: c.base, nota: c.nota, linha: c.linha, n: 0, visivel: c.visivel, liga: L.layerGroup() });
      t.n += c.n;
      if (c.visivel) grupo.addLayer(c.camada);
    }
    return { r, grupo, subs };
  });
  redeMapa.tipos = Rede.ORDEM.filter(k => tipos[k]).map(k => tipos[k]);
  for (const x of redeMapa.redes) {
    controleMapa.addOverlay(x.grupo, rotuloAlim(x.r));
    if (!ocultas().includes(chaveDe(x.r))) x.grupo.addTo(mapa);
  }
  for (const t of redeMapa.tipos) {
    controleMapa.addOverlay(t.liga, t.base + (t.linha ? '' : ` <small>(${t.n})${t.nota ? `, ${t.nota}` : ''}</small>`));
    if (t.visivel) t.liga.addTo(mapa);
  }
  redeMapa.tirarRotulos = Rede.rotulos(mapa, [].concat(...redeMapa.redes.map(x => x.subs)));
  titulosCamadas();
}

// Títulos "Alimentadores" e "Equipamentos" na lista de camadas do botão.
function titulosCamadas() {
  const lista = controleMapa.getContainer().querySelector('.leaflet-control-layers-overlays');
  lista.querySelectorAll('.titulo-camadas').forEach(t => t.remove());
  if (!redeMapa.redes.length) return;
  const titulo = txt => { const t = document.createElement('span'); t.className = 'titulo-camadas'; t.textContent = txt; return t; };
  lista.insertBefore(titulo('Alimentadores'), lista.firstChild);
  const primeiroTipo = lista.children[redeMapa.redes.length + 1];
  if (primeiroTipo) lista.insertBefore(titulo('Equipamentos'), primeiroTipo);
}

function botaoAlimentador() {
  const Controle = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const div = L.DomUtil.create('div', 'leaflet-bar');
      const a = L.DomUtil.create('a', 'btn-alim', div);
      a.href = '#';
      a.textContent = '+ Alimentador';
      a.title = 'Carregar a rede de outro alimentador';
      a.setAttribute('role', 'button');
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(a, 'click', e => { L.DomEvent.preventDefault(e); adicionarRede(); });
      return div;
    },
  });
  return new Controle();
}

function prepararMapa() {
  if (!mapa) {
    mapa = L.map('mapa', { zoomControl: true, preferCanvas: true });
    controleMapa = camadasBase(mapa);
    if (!MODO_ARTEFATO) botaoAlimentador().addTo(mapa);
    camadaPontos = L.layerGroup().addTo(mapa);
    mapa.on('click', e => { if (escolhendoPonto && marcador) { marcador.setLatLng(e.latlng); atualizarPonto(e.latlng); } });
    mapa.on('overlayadd overlayremove', e => {
      const liga = e.type === 'overlayadd';
      // tipo de equipamento: vale para todos os alimentadores e fica lembrado
      const t = redeMapa.tipos.find(x => x.liga === e.layer);
      if (t) {
        t.visivel = liga;
        Rede.lembrar(t.chave, liga);
        for (const x of redeMapa.redes) for (const c of x.subs) if (c.chave === t.chave) {
          if (liga) x.grupo.addLayer(c.camada); else x.grupo.removeLayer(c.camada);
        }
        return;
      }
      // alimentador: fica lembrado na inspeção (vale também para o mini-mapa)
      const x = redeMapa.redes.find(y => y.grupo === e.layer);
      if (x) {
        const k = chaveDe(x.r);
        salvarInspecao({ redesOcultas: liga ? ocultas().filter(c => c !== k) : ocultas().concat([k]) });
      }
    });
    // os títulos somem quando o Leaflet redesenha a lista
    mapa.on('overlayadd overlayremove baselayerchange', () => setTimeout(titulosCamadas, 0));
    // "tirar" ao lado de um alimentador acrescentado (sem ligar/desligar a camada)
    controleMapa.getContainer().addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('.tirar-rede');
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      tirarRede(a.getAttribute('data-chave'));
    }, true);
    botaoPosicao().addTo(mapa);
  }
  aplicarRedeMapa();
}

// Janela de um equipamento tocado no mapa. Ao escolher o ponto de um registro, dá para usar a posição
// do equipamento e citá-lo na descrição.
function mostrarEquipamento(it) {
  const div = document.createElement('div');
  div.className = 'equip';
  const h = document.createElement('h4');
  h.textContent = it.titulo;
  const tab = document.createElement('table');
  for (const [rot, val] of it.linhas) {
    if (!val) continue;
    const tr = tab.insertRow();
    tr.insertCell().textContent = rot;
    tr.insertCell().textContent = val;
  }
  div.append(h, tab);
  if (escolhendoPonto) {
    const usar = document.createElement('button');
    usar.className = 'btn primario';
    usar.textContent = 'Usar a posição deste equipamento';
    usar.addEventListener('click', () => {
      marcador.setLatLng(it.ll);
      atualizarPonto(it.ll);
      mapa.closePopup();
      // equipamento da rede de outro alimentador: o registro passa a ser desse alimentador
      const alim = (it.linhas.find(l => l[0] === 'Alimentador') || [])[1];
      if (alim && !Rede.igual(alim, $('fAlim').value)) {
        $('fAlim').value = alim;
        avisar(`Alimentador do registro trocado para ${alim}.`);
      }
    });
    const citar = document.createElement('button');
    citar.className = 'btn';
    citar.textContent = 'Usar a posição e citar na descrição';
    citar.addEventListener('click', () => {
      usar.click();
      const cod = (it.linhas.find(l => l[0] === 'Código') || [])[1];
      const ref = `${it.titulo}${cod ? ' ' + cod : ''}`;
      const desc = $('fDesc');
      if (!desc.value.includes(ref)) desc.value = desc.value.trim() ? `${desc.value.trim()} (${ref})` : ref;
    });
    div.append(usar, citar);
  }
  L.popup({ maxWidth: 260 }).setLatLng(it.ll).setContent(div).openOn(mapa);
}

// Posição atual no mapa: ponto azul com o círculo de precisão, que acompanha o GPS enquanto o mapa
// está aberto. O botão abaixo do zoom centraliza o mapa na posição (e liga o GPS se estiver desligado).
const posicao = { watch: null, ponto: null, circulo: null, ll: null, centrar: false, botao: null };
function botaoPosicao() {
  const Controle = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const div = L.DomUtil.create('div', 'leaflet-bar');
      const a = L.DomUtil.create('a', 'btn-posicao', div);
      a.href = '#';
      a.title = 'Minha posição';
      a.setAttribute('role', 'button');
      a.setAttribute('aria-label', 'Mostrar minha posição');
      a.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/>' +
        '<path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(a, 'click', e => {
        L.DomEvent.preventDefault(e);
        if (posicao.ll) mapa.setView(posicao.ll, Math.max(mapa.getZoom(), 17));
        else posicao.centrar = true;
        seguirPosicao();
      });
      posicao.botao = a;
      return div;
    },
  });
  return new Controle();
}
function seguirPosicao() {
  if (posicao.watch !== null || !('geolocation' in navigator)) return;
  if (posicao.botao) posicao.botao.classList.add('buscando');
  posicao.watch = navigator.geolocation.watchPosition(pos => {
    const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
    const raio = pos.coords.accuracy || 0;
    posicao.ll = ll;
    if (!posicao.ponto) {
      posicao.circulo = L.circle(ll, { radius: raio, color: '#1a73e8', weight: 1, fillOpacity: 0.12, interactive: false });
      posicao.ponto = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: '#1a73e8', fillOpacity: 1 })
        .bindTooltip('Você está aqui');
    }
    posicao.circulo.setLatLng(ll).setRadius(raio).addTo(mapa);
    posicao.ponto.setLatLng(ll).addTo(mapa).setTooltipContent(`Você está aqui (±${metros(raio)} m)`);
    if (posicao.botao) { posicao.botao.classList.remove('buscando'); posicao.botao.classList.add('ativo'); }
    if (posicao.centrar) { posicao.centrar = false; mapa.setView(ll, Math.max(mapa.getZoom(), 17)); }
  }, err => {
    if (err.code === 3) return; // continua esperando o GPS
    pararPosicao();
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
}
function pararPosicao() {
  if (posicao.watch !== null) navigator.geolocation.clearWatch(posicao.watch);
  posicao.watch = null;
  posicao.centrar = false;
  if (posicao.botao) posicao.botao.classList.remove('buscando', 'ativo');
}

function atualizarPonto(ll) {
  pontoEscolhido = ll;
  $('mapaCoords').textContent = `${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`;
}

function abrirMapa() {
  $('modalMapa').hidden = false;
  prepararMapa();
  mapa.invalidateSize();
}

$('btnMapa').addEventListener('click', () => {
  escolhendoPonto = true;
  abrirMapa();
  camadaPontos.clearLayers();
  $('btnConfirmarMapa').hidden = false;
  const lat = numero($('fLat').value), lon = numero($('fLon').value);
  const temPonto = lat !== null && lon !== null;
  const inicio = temPonto ? L.latLng(lat, lon) : redesNoMapa().length ? Rede.limites(redesNoMapa()).getCenter() : L.latLng(-23.5505, -46.6333);
  if (!marcador) marcador = L.marker(inicio, { draggable: true, zIndexOffset: 1000 }).on('drag', e => atualizarPonto(e.target.getLatLng()));
  marcador.setLatLng(inicio).addTo(mapa);
  if (temPonto) mapa.setView(inicio, 18);
  else if (redesNoMapa().length) mapa.fitBounds(Rede.limites(redesNoMapa()), { padding: [20, 20] });
  else mapa.setView(inicio, 12);
  atualizarPonto(inicio);
});

$('btnConfirmarMapa').addEventListener('click', () => {
  pararGps();
  estado.coordsManual = true;
  $('fLat').value = pontoEscolhido.lat.toFixed(6);
  $('fLon').value = pontoEscolhido.lng.toFixed(6);
  $('gpsInfo').textContent = 'Localização escolhida no mapa.';
  $('gpsInfo').className = 'dica';
  fecharMapa();
  mostrarNoMiniMapa(pontoEscolhido.lat, pontoEscolhido.lng, null);
});

$('btnMapaInsp').addEventListener('click', async () => {
  const regs = await registrosOrdenados(estado.inspecao.id);
  escolhendoPonto = false;
  abrirMapa();
  if (marcador) marcador.remove();
  camadaPontos.clearLayers();
  $('btnConfirmarMapa').hidden = true;
  $('mapaCoords').textContent = '';
  const pts = regs.map((r, i) => {
    const popup = document.createElement('div');
    popup.innerHTML = `<b>Foto ${i + 1}</b><br>`;
    popup.append(`Alim. ${alimDe(r)}`, document.createElement('br'), r.tipo, document.createElement('br'), fmt(r.dataHora));
    camadaPontos.addLayer(L.marker([r.lat, r.lon]).bindPopup(popup));
    return [r.lat, r.lon];
  });
  if (regs.length > 1) L.polyline(pts, { color: '#ea7501', weight: 3, dashArray: '4 4', interactive: false }).addTo(camadaPontos);
  const todas = carregadas().map(r => r.d);
  if (pts.length) mapa.fitBounds(pts, { padding: [40, 40], maxZoom: 18 });
  else if (todas.length) mapa.fitBounds(Rede.limites(redesNoMapa().length ? redesNoMapa() : todas), { padding: [20, 20] });
  else mapa.setView([-22.5, -48.5], 7); // estado de SP
  seguirPosicao();
});

function fecharMapa() {
  $('modalMapa').hidden = true;
  mapa.closePopup();
  pararPosicao();
}
$('btnFecharMapa').addEventListener('click', fecharMapa);

/* ------------------------------ pastas do app ------------------------------ */

// Mantém, para cada inspeção, Fotos/<pasta>/Foto_NN_<tipo>.jpg e Registros/<pasta>.csv
// iguais aos dados do app. Só regrava as fotos que mudaram (manifesto guardado na inspeção).
let filaPastas = Promise.resolve();
function sincronizar(inspecaoId, refazer = false) {
  if (!Pastas.suportado) return filaPastas;
  filaPastas = filaPastas.then(() => sincronizarAgora(inspecaoId, refazer)).catch(e => console.error('pastas', e));
  return filaPastas;
}

const nomeFoto = (r, n) => `Foto_${String(n).padStart(2, '0')}_${Pastas.seguro(r.tipo).slice(0, 50)}.jpg`;

function tabelaCsv(regs, insp) {
  const cel = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const cab = ['Nº', 'Alimentador', 'Tipo de irregularidade', 'Descrição', 'Data/hora', 'Latitude', 'Longitude', 'Precisão GPS (m)', 'Arquivo da foto'];
  const linhas = regs.map((r, i) => [i + 1, r.alimentador || insp.alimentador, r.tipo, r.descricao, fmt(r.dataHora),
    r.lat.toFixed(6).replace('.', ','), r.lon.toFixed(6).replace('.', ','), r.precisao ? Math.round(r.precisao) : '', r.foto ? nomeFoto(r, i + 1) : 'sem foto']);
  // ";" e BOM para o Excel em português abrir com acentos e colunas certas.
  return new Blob(['\ufeff' + [cab, ...linhas].map(l => l.map(cel).join(';')).join('\r\n')], { type: 'text/csv' });
}

async function sincronizarAgora(id, refazer) {
  const insp = await DB.obter('inspecoes', id);
  if (!insp) return;
  const regs = await registrosOrdenados(id);
  const pasta = Pastas.nomePasta(insp);
  const ant = (!refazer && insp.arquivos) || { pasta, fotos: {} };
  if (ant.pasta !== pasta) {
    await Pastas.remover(`${Pastas.FOTOS}/${ant.pasta}`);
    await Pastas.remover(`${Pastas.REGISTROS}/${ant.pasta}.csv`);
    ant.fotos = {};
  }
  const desejado = {};
  regs.forEach((r, i) => { if (r.foto) desejado[nomeFoto(r, i + 1)] = `${r.id}:${r.versao || 0}`; });
  for (const item of await Pastas.listar(`${Pastas.FOTOS}/${pasta}`))
    if (!(item.nome in desejado)) await Pastas.remover(`${Pastas.FOTOS}/${pasta}/${item.nome}`);
  for (const [i, r] of regs.entries()) {
    if (!r.foto) continue;
    const nome = nomeFoto(r, i + 1);
    if (ant.fotos[nome] !== desejado[nome]) await Pastas.gravar(`${Pastas.FOTOS}/${pasta}/${nome}`, r.foto);
  }
  await Pastas.gravar(`${Pastas.REGISTROS}/${pasta}.csv`, tabelaCsv(regs, insp));
  const atual = await DB.obter('inspecoes', id);
  if (atual) await DB.salvar('inspecoes', { ...atual, arquivos: { pasta, fotos: desejado } });
}

async function removerPastasDe(insp) {
  if (!Pastas.suportado) return;
  await filaPastas;
  const pasta = (insp.arquivos && insp.arquivos.pasta) || Pastas.nomePasta(insp);
  await Pastas.remover(`${Pastas.FOTOS}/${pasta}`);
  await Pastas.remover(`${Pastas.REGISTROS}/${pasta}.csv`);
}

const dataCurta = ms => fmt(ms).slice(0, 16);

function itemArquivo(icone, nome, detalhe, aoTocar) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="icone-arq"></span><div class="info"><strong></strong><small></small></div><span>&#8250;</span>`;
  li.querySelector('.icone-arq').textContent = icone;
  li.querySelector('strong').textContent = nome;
  li.querySelector('small').textContent = detalhe;
  li.addEventListener('click', aoTocar);
  return li;
}

function listaVazia(ul, texto) {
  const li = document.createElement('li');
  li.className = 'vazio'; li.textContent = texto;
  ul.appendChild(li);
}

async function telaArquivos() {
  mostrar('telaArquivos', 'Pastas do app');
  $('semPastas').hidden = Pastas.suportado;
  $('btnZipTudo').disabled = !Pastas.suportado;
  ['listaRelatorios', 'listaTabelas', 'listaFotos'].forEach(l => { $(l).innerHTML = ''; });
  if (!Pastas.suportado) return;
  await filaPastas;
  if (navigator.storage.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    $('usoEspaco').textContent = `Espaço usado pelo app: ${mb(usage)} de ${mb(quota)} disponíveis.`;
  }

  const rel = await Pastas.listar(Pastas.RELATORIOS);
  if (!rel.length) listaVazia($('listaRelatorios'), 'Nenhum relatório gerado ainda.');
  for (const f of rel) {
    const caminho = `${Pastas.RELATORIOS}/${f.nome}`;
    $('listaRelatorios').appendChild(itemArquivo(f.nome.endsWith('.pdf') ? '📕' : f.nome.endsWith('.kmz') ? '🗺️' : '📘', f.nome, `${dataCurta(f.modificado)} · ${mb(f.tamanho)}`,
      async () => oferecerArquivo(await Pastas.ler(caminho), {
        titulo: 'Relatório', pastaInfo: 'Pasta Relatórios do app.',
        aoExcluir: async () => { await Pastas.remover(caminho); telaArquivos(); },
      })));
  }

  const tabs = await Pastas.listar(Pastas.REGISTROS);
  if (!tabs.length) listaVazia($('listaTabelas'), 'Nenhuma inspeção com registros.');
  for (const f of tabs) {
    const caminho = `${Pastas.REGISTROS}/${f.nome}`;
    $('listaTabelas').appendChild(itemArquivo('📊', f.nome, `${dataCurta(f.modificado)} · abre no Excel`,
      async () => oferecerArquivo(await Pastas.ler(caminho), { titulo: 'Tabela de registros', pastaInfo: 'Pasta Registros do app. Atualizada a cada registro salvo.' })));
  }

  const fotos = (await Pastas.listar(Pastas.FOTOS)).filter(f => f.pasta);
  if (!fotos.length) listaVazia($('listaFotos'), 'Nenhuma foto ainda.');
  for (const d of fotos) {
    $('listaFotos').appendChild(itemArquivo('📁', d.nome, `${d.itens} ${d.itens === 1 ? 'foto' : 'fotos'} · ${mb(d.tamanho)}`, async () => {
      avisar('Preparando as fotos…', 2000);
      const zip = await Pastas.zip(`${Pastas.FOTOS}/${d.nome}`);
      oferecerArquivo(new File([zip], `Fotos_${d.nome}.zip`, { type: 'application/zip' }), { titulo: 'Fotos da inspeção', pastaInfo: `Pasta Fotos/${d.nome} do app, compactada.` });
    }));
  }
}

$('btnArquivos').addEventListener('click', () => { ir('telaArquivos'); telaArquivos(); });
$('btnZipTudo').addEventListener('click', async () => {
  const b = $('btnZipTudo');
  b.disabled = true; b.textContent = 'Compactando…';
  try {
    await filaPastas;
    const d = new Date();
    const nome = `Inspecao_Redes_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`;
    oferecerArquivo(new File([await Pastas.zip()], nome, { type: 'application/zip' }),
      { titulo: 'Pastas do app', pastaInfo: 'Contém as pastas Relatorios, Registros e Fotos.' });
  } catch (e) {
    avisar('Não foi possível compactar: ' + e.message, 6000);
  } finally {
    b.disabled = false; b.textContent = 'Exportar tudo (.zip)';
  }
});

/* ------------------------------ backup ------------------------------ */

const blobParaDataUrl = b => new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });

$('btnExportar').addEventListener('click', async () => {
  const inspecoes = await DB.todos('inspecoes');
  const registros = [];
  for (const r of await DB.todos('registros')) registros.push({ ...r, foto: r.foto ? await blobParaDataUrl(r.foto) : null });
  const d = new Date();
  const nome = `backup_inspecoes_${d.toISOString().slice(0, 10)}.json`;
  baixar(new Blob([JSON.stringify({ app: 'inspecao-redes', versao: 2, inspecoes, registros })], { type: 'application/json' }), nome);
});

$('inpImportar').addEventListener('change', async e => {
  const arq = e.target.files[0];
  e.target.value = '';
  if (!arq) return;
  try {
    const dados = JSON.parse(await arq.text());
    if (dados.app !== 'inspecao-redes') throw new Error('arquivo não é um backup deste aplicativo');
    for (const i of dados.inspecoes) await DB.salvar('inspecoes', i);
    const dataUrlParaBlob = url => {
      const [cab, b64] = url.split(',');
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: cab.slice(5).split(';')[0] });
    };
    for (const r of dados.registros) await DB.salvar('registros', { ...r, foto: r.foto ? dataUrlParaBlob(r.foto) : null });
    for (const i of dados.inspecoes) sincronizar(i.id, true);
    avisar(`Backup importado: ${dados.inspecoes.length} inspeções, ${dados.registros.length} registros.`);
    telaInicio();
  } catch (err) {
    avisar('Falha ao importar: ' + err.message, 6000);
  }
});

/* ------------------------------ inspeções da versão 1.0 ------------------------------ */

async function verificarV1() {
  try {
    const v1 = await DB.dadosV1();
    const atuais = new Set((await DB.todos('inspecoes')).map(i => i.id));
    const novas = v1 ? v1.inspecoes.filter(i => !atuais.has(i.id)) : [];
    $('blocoV1').hidden = !novas.length;
    return v1;
  } catch (e) {
    console.error(e);
    return null;
  }
}

$('btnCopiarV1').addEventListener('click', async () => {
  const v1 = await verificarV1();
  if (!v1) return;
  const atuais = new Set((await DB.todos('inspecoes')).map(i => i.id));
  const novas = v1.inspecoes.filter(i => !atuais.has(i.id));
  const ids = new Set(novas.map(i => i.id));
  const regs = v1.registros.filter(r => ids.has(r.inspecaoId));
  for (const i of novas) await DB.salvar('inspecoes', { ...i, arquivos: undefined });
  for (const r of regs) await DB.salvar('registros', r);
  for (const i of novas) sincronizar(i.id, true);
  avisar(`Copiadas ${novas.length} ${novas.length === 1 ? 'inspeção' : 'inspeções'} com ${regs.length} ${regs.length === 1 ? 'registro' : 'registros'}. Para ver a rede no mapa, use “Alterar” e escolha a distribuidora e o alimentador.`, 8000);
  $('blocoV1').hidden = true;
  telaInicio();
});

/* ------------------------------ início ------------------------------ */

function statusRede() {
  const el = $('statusRede');
  el.textContent = navigator.onLine ? 'online' : 'offline';
  el.classList.toggle('off', !navigator.onLine);
}
addEventListener('online', statusRede);
addEventListener('offline', statusRede);
statusRede();

if (MODO_ARTEFATO) {
  // Sem GPS nem mapa nesta versão: coordenadas digitadas.
  ['btnGps', 'btnMapa', 'btnMapaInsp'].forEach(b => { $(b).hidden = true; });
  $('avisoTeste').hidden = false;
} else if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(console.error);
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

history.replaceState({ tela: 'telaInicio' }, '');
telaInicio();
verificarV1();
DB.todos('inspecoes').then(insps => insps.filter(i => !i.arquivos).forEach(i => sincronizar(i.id)));
