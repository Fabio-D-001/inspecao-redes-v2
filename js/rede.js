// Rede elétrica dos alimentadores (BDGD da ANEEL, pré-processada em dados/): lista de distribuidoras e
// alimentadores, dados de cada alimentador e as camadas do mapa (rede primária e equipamentos).
const Rede = (() => {
  // Tipos de unidade (campo TIP_UNID, tabela TTIPUNID do Módulo 10 do PRODIST) das chaves e equipamentos de manobra.
  const TIP_UNID = {
    15: 'Abertura de jumper', 16: 'Chave a gás', 17: 'Chave a óleo', 18: 'Chave de transferência automática',
    19: 'Chave faca', 20: 'Chave faca tripolar abertura com carga', 21: 'Chave faca unipolar abertura com carga',
    22: 'Chave fusível', 23: 'Chave fusível abertura com carga com aterramento', 24: 'Chave fusível abertura sem carga',
    25: 'Chave fusível abertura sem carga com aterramento', 26: 'Chave fusível lâmina',
    27: 'Chave fusível religadora', 28: 'Chave motorizada', 29: 'Disjuntor', 30: 'Disjuntor de interligação de barra',
    31: 'Lâmina desligadora', 32: 'Religador', 33: 'Seccionadora tripolar de subestação',
    34: 'Seccionadora unipolar de subestação', 35: 'Seccionalizador', 36: 'Seccionalizador monofásico',
    46: 'Fusível', 47: 'Seccionadora com lâmina de terra', 48: 'Seccionadora em módulo de manobra',
    49: 'Chave tipo tandem', 50: 'Seccionadora com bobina', 53: 'Disjuntor em módulo de manobra SF6',
  };
  const FUSIVEIS = [22, 23, 24, 25, 26, 27, 46];
  const PROTECAO = [29, 30, 32, 35, 36, 53];
  const grupoChave = tip => (FUSIVEIS.includes(+tip) ? 'fusiveis' : PROTECAO.includes(+tip) ? 'religadores' : 'seccionadoras');

  // Ordem e aparência das camadas. "padrao": aparece ao abrir o mapa pela primeira vez.
  const CAMADAS = [
    { chave: 'rede3', rotulo: 'Rede primária trifásica', cor: '#c1121f', linha: true, padrao: true },
    { chave: 'rede1', rotulo: 'Rede primária mono/bifásica', cor: '#e85d04', linha: true, padrao: true },
    { chave: 'trafos', rotulo: 'Transformadores', cor: '#7b2cbf', raio: 5, padrao: true },
    { chave: 'fusiveis', rotulo: 'Chaves fusíveis', cor: '#2a9d8f', raio: 4, padrao: true },
    { chave: 'seccionadoras', rotulo: 'Chaves seccionadoras', cor: '#0062ab', raio: 4, padrao: true },
    { chave: 'religadores', rotulo: 'Religadores, disjuntores e seccionalizadores', cor: '#212529', borda: '#ffd60a', raio: 6, padrao: true },
    { chave: 'reguladores', rotulo: 'Reguladores de tensão', cor: '#4f772d', raio: 6, padrao: true },
    { chave: 'capacitores', rotulo: 'Bancos de capacitores', cor: '#9c6644', raio: 6, padrao: true },
    { chave: 'postes', rotulo: 'Postes (aparecem com zoom ≥ 16)', cor: '#6c757d', raio: 2.5, padrao: false },
    { chave: 'sub', rotulo: 'Subestação', cor: '#ffd60a', borda: '#212529', raio: 9, padrao: true },
  ];

  const PREF = 'inspecao-v2-camadas';
  function preferencias() {
    try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch (e) { return {}; }
  }
  function lembrar(chave, visivel) {
    const p = preferencias();
    p[chave] = visivel;
    try { localStorage.setItem(PREF, JSON.stringify(p)); } catch (e) { /* sem armazenamento: só não lembra */ }
  }
  const visivel = c => { const p = preferencias()[c.chave]; return p === undefined ? c.padrao : p; };

  const json = async url => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  let indice = null;
  const distribuidoras = () => (indice = indice || json('dados/distribuidoras.json').catch(e => { indice = null; throw e; }));
  const pasta = async () => (await distribuidoras()).pasta;

  const listas = {};
  async function alimentadores(distId) {
    if (!listas[distId]) listas[distId] = json(`${await pasta()}/${distId}/alimentadores.json`)
      .then(d => d.alimentadores.map(([cod, nome, sub, subNome, arq, trafos]) => ({ cod, nome: nome.replace(/\s+/g, ' '), sub, subNome, arq, trafos })))
      .catch(e => { delete listas[distId]; throw e; });
    return listas[distId];
  }

  // Nome do alimentador usado na inspeção e no relatório.
  const rotulo = a => a.nome || a.cod;

  // Busca sem acento, maiúsculas nem espaços ("itq 02" acha "ITQ02").
  const normal = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s._-]+/g, '').toLowerCase();
  function filtrar(lista, texto, max = 40) {
    const t = normal(texto);
    if (!t) return lista.slice(0, max);
    const comeca = [], contem = [];
    for (const a of lista) {
      const nome = normal(a.nome), cod = normal(a.cod);
      if (nome.startsWith(t) || cod.startsWith(t)) comeca.push(a);
      else if (nome.includes(t) || cod.includes(t) || normal(a.sub).includes(t) || normal(a.subNome).includes(t)) contem.push(a);
      if (comeca.length >= max) break;
    }
    return comeca.concat(contem).slice(0, max);
  }
  const igual = (a, b) => normal(a) === normal(b);

  const carregados = new Map();
  async function dados(distId, arq) {
    const chave = `${distId}/${arq}`;
    if (!carregados.has(chave)) {
      carregados.set(chave, json(`${await pasta()}/${distId}/a/${encodeURIComponent(arq)}.json`)
        .catch(e => { carregados.delete(chave); throw e; }));
    }
    return carregados.get(chave);
  }

  /* ------------------------------ camadas do mapa ------------------------------ */

  const fases = f => (f ? `Fases ${f}` : '');
  const ponto = (x, y) => L.latLng(y, x);
  const alimDe = d => ['Alimentador', d.nome || d.cod];

  // Itens de cada camada: { ll, cod, titulo, linhas: [[rótulo, valor]] }
  function itens(d, chave) {
    switch (chave) {
      case 'trafos': return d.trafos.map(([x, y, kva, f, cod]) => ({ ll: ponto(x, y), cod, titulo: 'Transformador',
        linhas: [['Código', cod], ['Potência', kva ? `${String(kva).replace('.', ',')} kVA` : ''], ['Ligação', fases(f)], alimDe(d)] }));
      case 'fusiveis': case 'seccionadoras': case 'religadores':
        return d.chaves.filter(c => grupoChave(c[2]) === chave).map(([x, y, tip, estado, cod, f]) => ({ ll: ponto(x, y), cod,
          titulo: TIP_UNID[tip] || `Equipamento de manobra (tipo ${tip})`, aberta: estado === 'A',
          linhas: [['Código', cod], ['Estado normal', estado === 'A' ? 'Aberta (NA)' : estado === 'F' ? 'Fechada (NF)' : ''], ['Ligação', fases(f)], alimDe(d)] }));
      case 'reguladores': return d.reguladores.map(([x, y, cod, f]) => ({ ll: ponto(x, y), cod, titulo: 'Regulador de tensão',
        linhas: [['Código', cod], ['Ligação', fases(f)], alimDe(d)] }));
      case 'capacitores': return d.capacitores.map(([x, y, cod, f]) => ({ ll: ponto(x, y), cod, titulo: 'Banco de capacitores',
        linhas: [['Código', cod], ['Ligação', fases(f)], alimDe(d)] }));
      case 'sub': return d.subPt ? [{ ll: ponto(d.subPt[0], d.subPt[1]), cod: d.sub, titulo: 'Subestação',
        linhas: [['Nome', d.subNome], ['Sigla', d.sub]] }] : [];
      default: return [];
    }
  }

  // Linhas de uma camada de rede como listas de L.latLng.
  const linhas = (d, chave) => (d[chave] || []).map(coords => {
    const lls = [];
    for (let i = 0; i < coords.length; i += 2) lls.push([coords[i + 1], coords[i]]);
    return lls;
  });

  // Monta as camadas dos alimentadores "redes" (lista de dados) para o mapa "m". aoTocar(item) recebe o
  // equipamento tocado. Devolve [{ chave, rotulo (HTML com a cor), camada, visivel, pontos }], só das
  // camadas com algo; "pontos" são os equipamentos com código, para os rótulos.
  function camadas(m, redes, { aoTocar = null, interativo = true, so = null } = {}) {
    if (!m.getPane('postes')) {
      m.createPane('postes').style.zIndex = 390;
      const ajustar = () => { m.getPane('postes').style.display = m.getZoom() >= 16 ? '' : 'none'; };
      m.on('zoomend', ajustar); ajustar();
    }
    const canvas = L.canvas({ padding: 0.3 });
    const canvasPostes = L.canvas({ padding: 0.3, pane: 'postes' });
    const saida = [];
    for (const c of CAMADAS) {
      if (so && !so.includes(c.chave)) continue;
      const grupo = L.featureGroup();
      const pontos = [];
      let n = 0;
      for (const d of redes) {
        if (c.linha) {
          for (const lls of linhas(d, c.chave)) {
            L.polyline(lls, { renderer: canvas, color: c.cor, weight: c.chave === 'rede3' ? 3 : 2, opacity: 0.85,
              dashArray: c.chave === 'rede1' ? '6 4' : null, interactive: false }).addTo(grupo);
            n++;
          }
        } else if (c.chave === 'postes') {
          const p = d.postes || [];
          for (let i = 0; i < p.length; i += 2) {
            L.circleMarker([p[i + 1], p[i]], { renderer: canvasPostes, pane: 'postes', radius: c.raio, color: '#fff', weight: 1,
              fillColor: c.cor, fillOpacity: 1, interactive: false }).addTo(grupo);
            n++;
          }
        } else {
          for (const it of itens(d, c.chave)) {
            const mk = L.circleMarker(it.ll, { renderer: canvas, radius: c.raio, color: c.borda || '#fff', weight: c.borda ? 2 : 1,
              fillColor: it.aberta ? '#fff' : c.cor, fillOpacity: 1, interactive: interativo });
            if (it.aberta) mk.setStyle({ color: c.cor, weight: 2 });
            if (interativo && aoTocar) mk.on('click', () => aoTocar(it));
            mk.addTo(grupo);
            if (it.cod) pontos.push(it);
            n++;
          }
        }
      }
      if (!n) continue;
      const rot = `<span class="leg${c.linha ? ' leg-linha' : ''}" style="background:${c.cor}"></span>${c.rotulo}` +
        (c.linha ? '' : ` <small>(${n})</small>`);
      saida.push({ chave: c.chave, rotulo: rot, camada: grupo, visivel: visivel(c), pontos });
    }
    return saida;
  }

  // Rótulos com o código dos equipamentos das camadas ligadas, só com zoom alto e só na área visível
  // (são milhares de equipamentos). Devolve uma função que tira os rótulos e para de acompanhar o mapa.
  const ZOOM_ROTULOS = 17, MAX_ROTULOS = 300;
  function rotulos(m, lista) {
    if (!m.getPane('rotulos')) {
      const p = m.createPane('rotulos');
      p.style.zIndex = 450;
      p.style.pointerEvents = 'none';
    }
    const grupo = L.layerGroup().addTo(m);
    const atualizar = () => {
      grupo.clearLayers();
      if (m.getZoom() < ZOOM_ROTULOS) return;
      const area = m.getBounds().pad(0.1);
      let n = 0;
      for (const c of lista) {
        if (!m.hasLayer(c.camada)) continue;
        for (const it of c.pontos) {
          if (n >= MAX_ROTULOS) return;
          if (!area.contains(it.ll)) continue;
          const el = document.createElement('span');
          el.textContent = it.cod;
          L.marker(it.ll, { pane: 'rotulos', interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'rotulo-equip', html: el.outerHTML, iconSize: null, iconAnchor: [-8, 8] }) }).addTo(grupo);
          n++;
        }
      }
    };
    m.on('moveend overlayadd overlayremove', atualizar);
    m.whenReady(atualizar); // o mapa pode ainda não ter posição (primeira abertura)
    return () => { m.off('moveend overlayadd overlayremove', atualizar); grupo.remove(); };
  }

  // Limites de um ou mais alimentadores para o mapa.
  const limites = redes => {
    const b = L.latLngBounds([]);
    for (const d of [].concat(redes)) b.extend([[d.bbox[1], d.bbox[0]], [d.bbox[3], d.bbox[2]]]);
    return b;
  };

  // Conteúdo de um alimentador para exportar (KMZ): [{ chave, rotulo, cor, borda, linhas | pontos | postes }].
  function exportar(d) {
    const saida = [];
    for (const c of CAMADAS) {
      const item = { chave: c.chave, rotulo: c.rotulo.replace(/ \(.*\)$/, ''), cor: c.cor, borda: c.borda || null };
      if (c.linha) item.linhas = linhas(d, c.chave);
      else if (c.chave === 'postes') {
        const p = d.postes || [];
        item.postes = [];
        for (let i = 0; i < p.length; i += 2) item.postes.push([p[i + 1], p[i]]);
      } else item.pontos = itens(d, c.chave);
      const n = (item.linhas || item.postes || item.pontos).length;
      if (n) saida.push(item);
    }
    return saida;
  }

  return { distribuidoras, alimentadores, rotulo, filtrar, igual, dados, camadas, rotulos, limites, exportar, lembrar,
    visivelChave: chave => visivel(CAMADAS.find(c => c.chave === chave)) };
})();
