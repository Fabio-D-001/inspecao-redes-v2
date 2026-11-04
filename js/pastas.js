// Pastas do app no aparelho (Origin Private File System): Relatorios/, Registros/ e Fotos/,
// dentro de InspecaoRedes2/ para não misturar com as da versão 1.0 (mesmo endereço do site).
// É uma área de arquivos exclusiva do app; para levá-la ao gerenciador de arquivos do
// celular, exporta-se em .zip.
const Pastas = (() => {
  const suportado = !!(navigator.storage && navigator.storage.getDirectory);
  const RELATORIOS = 'Relatorios', REGISTROS = 'Registros', FOTOS = 'Fotos';
  const RAIZ = 'InspecaoRedes2';

  const seguro = txt => String(txt).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '');
  const dois = n => String(n).padStart(2, '0');

  function nomePasta(insp) {
    const d = new Date(insp.criadaEm);
    return `${seguro(insp.alimentador)}_${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}_${dois(d.getHours())}${dois(d.getMinutes())}`;
  }

  async function pasta(caminho, criar = true) {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(RAIZ, { create: true });
    for (const p of caminho.split('/').filter(Boolean)) d = await d.getDirectoryHandle(p, { create: criar });
    return d;
  }

  const separar = caminho => {
    const partes = caminho.split('/');
    return [partes.slice(0, -1).join('/'), partes[partes.length - 1]];
  };

  // Safari antigo não tem createWritable na página: grava por um worker (createSyncAccessHandle).
  let worker, pedidos = 0;
  const pendentes = new Map();
  function gravarViaWorker(caminho, buffer) {
    if (!worker) {
      const codigo = `onmessage = async e => {
        const { id, caminho, buffer } = e.data;
        try {
          const partes = ['${RAIZ}', ...caminho.split('/')]; const nome = partes.pop();
          let d = await navigator.storage.getDirectory();
          for (const p of partes) d = await d.getDirectoryHandle(p, { create: true });
          const h = await (await d.getFileHandle(nome, { create: true })).createSyncAccessHandle();
          h.truncate(0); h.write(new Uint8Array(buffer), { at: 0 }); h.flush(); h.close();
          postMessage({ id });
        } catch (err) { postMessage({ id, erro: err.message }); }
      };`;
      worker = new Worker(URL.createObjectURL(new Blob([codigo], { type: 'text/javascript' })));
      worker.onmessage = e => {
        const { id, erro } = e.data;
        const p = pendentes.get(id); pendentes.delete(id);
        erro ? p.falha(new Error(erro)) : p.ok();
      };
    }
    const id = ++pedidos;
    return new Promise((ok, falha) => {
      pendentes.set(id, { ok, falha });
      worker.postMessage({ id, caminho, buffer }, [buffer]);
    });
  }

  async function gravar(caminho, blob) {
    const [dir, nome] = separar(caminho);
    const arq = await (await pasta(dir)).getFileHandle(nome, { create: true });
    if (arq.createWritable) {
      const w = await arq.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      await gravarViaWorker(caminho, await blob.arrayBuffer());
    }
  }

  async function remover(caminho) {
    const [dir, nome] = separar(caminho);
    try { await (await pasta(dir, false)).removeEntry(nome, { recursive: true }); }
    catch (e) { if (e.name !== 'NotFoundError') throw e; }
  }

  async function ler(caminho) {
    const [dir, nome] = separar(caminho);
    return (await (await pasta(dir, false)).getFileHandle(nome)).getFile();
  }

  // Conteúdo de uma pasta: [{ nome, pasta: bool, tamanho, modificado, itens }]
  async function listar(caminho) {
    let d;
    try { d = await pasta(caminho, false); } catch (e) { return []; }
    const itens = [];
    for await (const [nome, h] of d.entries()) {
      if (h.kind === 'file') {
        const f = await h.getFile();
        itens.push({ nome, pasta: false, tamanho: f.size, modificado: f.lastModified });
      } else {
        let n = 0, tamanho = 0;
        for await (const [, sub] of h.entries()) if (sub.kind === 'file') { n++; tamanho += (await sub.getFile()).size; }
        itens.push({ nome, pasta: true, itens: n, tamanho });
      }
    }
    return itens.sort((a, b) => (b.modificado || 0) - (a.modificado || 0) || a.nome.localeCompare(b.nome));
  }

  // Compacta uma pasta (ou tudo) num .zip, mantendo a estrutura de pastas.
  async function zip(caminho = '') {
    const z = new JSZip();
    async function adicionar(d, prefixo) {
      for await (const [nome, h] of d.entries()) {
        if (h.kind === 'file') z.file(prefixo + nome, await h.getFile());
        else await adicionar(h, `${prefixo}${nome}/`);
      }
    }
    const base = caminho ? `${caminho.split('/').pop()}/` : '';
    await adicionar(await pasta(caminho), base);
    return z.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  }

  return { suportado, RELATORIOS, REGISTROS, FOTOS, seguro, nomePasta, gravar, remover, ler, listar, zip };
})();
