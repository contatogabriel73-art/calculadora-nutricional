/* ============================================================
   taco.js — base de alimentos e cálculo nutricional

   Fonte única da base TACO, da busca e da soma de nutrientes. Existe
   porque a ficha técnica e o plano alimentar precisam exatamente das
   mesmas contas: se cada tela tivesse a sua cópia, uma correção feita
   num lugar deixaria o outro devolvendo número diferente para o mesmo
   alimento — num sistema clínico isso é inaceitável.

   Sem DOM. Quem desenha é app.js (ficha) e js/plano.js (plano).
   ============================================================ */

'use strict';

const TacoBase = (() => {

  let alimentos = [];
  let indicePorId = new Map();
  let diarios = {};
  let textoFonte = '';
  let promessa = null;

  /* Nutrientes do rótulo ANVISA, na ordem em que aparecem.
     `recuo` → sub-item indentado; `vd` → chave em valoresDiarios (null = sem %VD) */
  const NUTRIENTES = [
    { chave: 'kcal',              rotulo: 'Valor energético',    unidade: 'kcal', casas: 0, vd: 'kcal', destaque: true },
    { chave: 'carboidratos',      rotulo: 'Carboidratos totais', unidade: 'g',    casas: 1, vd: 'carboidratos' },
    { chave: 'acucares',          rotulo: 'Açúcares totais',     unidade: 'g',    casas: 1, vd: null, recuo: true },
    { chave: 'proteinas',         rotulo: 'Proteínas',           unidade: 'g',    casas: 1, vd: 'proteinas' },
    { chave: 'gordurasTotais',    rotulo: 'Gorduras totais',     unidade: 'g',    casas: 1, vd: 'gordurasTotais' },
    { chave: 'gordurasSaturadas', rotulo: 'Gorduras saturadas',  unidade: 'g',    casas: 1, vd: 'gordurasSaturadas', recuo: true },
    { chave: 'fibras',            rotulo: 'Fibra alimentar',     unidade: 'g',    casas: 1, vd: 'fibras' },
    { chave: 'sodio',             rotulo: 'Sódio',               unidade: 'mg',   casas: 0, vd: 'sodio' }
  ];

  /** Remove acentos e caixa para busca tolerante ("acucar" acha "Açúcar"). */
  function normalizar(txt) {
    return (txt || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // tira os diacríticos do NFD
      .replace(/\s+/g, ' ');
  }

  function escapar(txt) {
    return String(txt == null ? '' : txt).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** Carrega data/taco.json uma vez só; chamadas seguintes reaproveitam. */
  function carregar() {
    if (promessa) return promessa;

    promessa = fetch('data/taco.json', { cache: 'no-cache' })
      .then((resp) => {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then((dados) => {
        alimentos = dados.alimentos || [];
        diarios = dados.valoresDiarios || {};
        textoFonte = dados.fonte || 'Tabela TACO — NEPA/UNICAMP';
        indicePorId = new Map(alimentos.map((a) => [a.id, a]));

        // Índice de busca pré-calculado (nome + categoria sem acento).
        alimentos.forEach((a) => {
          a._busca = normalizar(a.nome + ' ' + a.categoria);
          a._palavras = a._busca.split(/[\s,()\-—/]+/).filter(Boolean);
        });
        return alimentos;
      })
      .catch((erro) => {
        promessa = null;   // permite tentar de novo
        throw erro;
      });

    return promessa;
  }

  function buscar(termo, maximo) {
    const q = normalizar(termo).trim();
    if (q.length < 1) return [];

    const termos = q.split(/\s+/).filter(Boolean);
    const achados = [];

    for (const alimento of alimentos) {
      // Todos os termos digitados precisam aparecer no alimento (busca "E").
      if (!termos.every((t) => alimento._busca.includes(t))) continue;

      // Pontuação: começo do nome > começo de alguma palavra > qualquer posição.
      const primeiro = termos[0];
      let pontos = 2;
      if (alimento._busca.startsWith(primeiro)) pontos = 0;
      else if (alimento._palavras.some((p) => p.startsWith(primeiro))) pontos = 1;

      achados.push({ alimento, pontos });
    }

    achados.sort((a, b) => a.pontos - b.pontos ||
      a.alimento.nome.localeCompare(b.alimento.nome, 'pt-BR'));
    return achados.slice(0, maximo || 10).map((r) => r.alimento);
  }

  /** Envolve em <mark> a primeira ocorrência do termo, ignorando acentos. */
  function destacar(nome, termo) {
    const q = normalizar(termo).trim().split(/\s+/)[0];
    if (!q) return escapar(nome);
    const i = normalizar(nome).indexOf(q);
    if (i < 0) return escapar(nome);
    return escapar(nome.slice(0, i)) +
           '<mark>' + escapar(nome.slice(i, i + q.length)) + '</mark>' +
           escapar(nome.slice(i + q.length));
  }

  function obter(id) { return indicePorId.get(id) || null; }
  function porId() { return indicePorId; }
  function todos() { return alimentos; }
  function valoresDiarios() { return diarios; }
  function fonte() { return textoFonte; }

  /** Zera um acumulador com todas as chaves de nutriente. */
  function zerado() {
    const t = {};
    NUTRIENTES.forEach((n) => { t[n.chave] = 0; });
    return t;
  }

  /**
   * Nutrientes de uma quantidade de um alimento.
   * @returns {object|null} null se o alimento não existir na base
   */
  function nutrientesDe(foodId, gramas) {
    const alimento = obter(foodId);
    if (!alimento) return null;
    const fator = (Number(gramas) || 0) / 100;
    const valores = {};
    NUTRIENTES.forEach((n) => { valores[n.chave] = (alimento.por100g[n.chave] || 0) * fator; });
    return valores;
  }

  /**
   * Soma uma lista de itens.
   * @param {Array<{foodId, gramas}>} itens
   * @returns {{totais, peso, linhas}} linhas traz alimento e valores de cada item
   */
  function somar(itens) {
    const totais = zerado();
    let peso = 0;
    const linhas = [];

    for (const item of itens || []) {
      const alimento = obter(item.foodId);
      if (!alimento) continue;
      const gramas = Number(item.gramas) || 0;
      const valores = nutrientesDe(item.foodId, gramas);
      NUTRIENTES.forEach((n) => { totais[n.chave] += valores[n.chave]; });
      peso += gramas;
      linhas.push({ item, alimento, gramas, valores });
    }

    return { totais, peso, linhas };
  }

  return {
    NUTRIENTES, normalizar, escapar, carregar, buscar, destacar,
    obter, porId, todos, valoresDiarios, fonte,
    zerado, nutrientesDe, somar
  };
})();
