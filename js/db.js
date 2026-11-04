// Armazenamento local (IndexedDB): inspeções e registros com a foto em Blob.
// A versão 2.0 usa um banco próprio; o da 1.0 ('inspecao-redes') só é lido para copiar as inspeções.
const DB = (() => {
  const NOME = 'inspecao-redes-v2';
  const NOME_V1 = 'inspecao-redes';
  let conexao;

  function abrir() {
    if (conexao) return Promise.resolve(conexao);
    return new Promise((ok, falha) => {
      const req = indexedDB.open(NOME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('inspecoes', { keyPath: 'id' });
        const reg = db.createObjectStore('registros', { keyPath: 'id' });
        reg.createIndex('inspecaoId', 'inspecaoId');
      };
      req.onsuccess = () => { conexao = req.result; ok(conexao); };
      req.onerror = () => falha(req.error);
    });
  }

  async function transacao(loja, modo, fn) {
    const db = await abrir();
    return new Promise((ok, falha) => {
      const tx = db.transaction(loja, modo);
      const resultado = fn(tx.objectStore(loja));
      tx.oncomplete = () => ok(resultado && 'result' in resultado ? resultado.result : resultado);
      tx.onerror = () => falha(tx.error);
    });
  }

  const salvar = (loja, obj) => transacao(loja, 'readwrite', s => s.put(obj));
  const obter = (loja, id) => transacao(loja, 'readonly', s => s.get(id));
  const todos = loja => transacao(loja, 'readonly', s => s.getAll());
  const excluir = (loja, id) => transacao(loja, 'readwrite', s => s.delete(id));
  const registrosDe = inspecaoId =>
    transacao('registros', 'readonly', s => s.index('inspecaoId').getAll(inspecaoId));

  async function excluirInspecao(id) {
    for (const r of await registrosDe(id)) await excluir('registros', r.id);
    await excluir('inspecoes', id);
  }

  // Inspeções da versão 1.0 neste aparelho (mesmo endereço do site). Só abre o banco antigo se ele
  // existir: abrir um banco inexistente o criaria vazio e estragaria a versão 1.0.
  async function dadosV1() {
    if (!indexedDB.databases) return null;
    const bancos = await indexedDB.databases();
    if (!bancos.some(b => b.name === NOME_V1)) return null;
    const db = await new Promise((ok, falha) => {
      const req = indexedDB.open(NOME_V1);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => falha(req.error);
    });
    try {
      if (!db.objectStoreNames.contains('inspecoes')) return null;
      const ler = loja => new Promise((ok, falha) => {
        const req = db.transaction(loja, 'readonly').objectStore(loja).getAll();
        req.onsuccess = () => ok(req.result);
        req.onerror = () => falha(req.error);
      });
      return { inspecoes: await ler('inspecoes'), registros: await ler('registros') };
    } finally {
      db.close();
    }
  }

  return { salvar, obter, todos, excluir, registrosDe, excluirInspecao, dadosV1 };
})();
