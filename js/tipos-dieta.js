/* ============================================================
   tipos-dieta.js — catálogo de formatos de dieta (data/tipos-dieta.json)

   Mesmo padrão de carregamento de TacoBase (js/taco.js): busca o JSON
   uma vez, reaproveita a promessa nas chamadas seguintes. Sem DOM —
   quem desenha é js/plano.js.
   ============================================================ */

'use strict';

const TiposDieta = (() => {

  let tipos = [];
  let categorias = [];
  let indicePorId = new Map();
  let promessa = null;

  /** Carrega data/tipos-dieta.json uma vez só; chamadas seguintes reaproveitam. */
  function carregar() {
    if (promessa) return promessa;

    promessa = fetch('data/tipos-dieta.json', { cache: 'no-cache' })
      .then((resp) => {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then((dados) => {
        tipos = dados.tipos || [];
        categorias = dados.categorias || [];
        indicePorId = new Map(tipos.map((t) => [t.id, t]));
        return tipos;
      })
      .catch((erro) => {
        promessa = null; // permite tentar de novo
        throw erro;
      });

    return promessa;
  }

  function porId(id) {
    return indicePorId.get(id) || null;
  }

  /** Tipos agrupados por categoria, na ordem declarada no JSON. */
  function agrupadosPorCategoria() {
    return categorias.map((categoria) => ({
      categoria,
      tipos: tipos.filter((t) => t.categoria === categoria)
    })).filter((grupo) => grupo.tipos.length > 0);
  }

  return { carregar, porId, agrupadosPorCategoria };
})();
