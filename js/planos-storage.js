/* ============================================================
   planos-storage.js — planos alimentares e metas do paciente

   • Plano alimentar: VÁRIOS por paciente. Cada plano tem refeições, e
     cada refeição tem itens (alimento + gramas).
   • Metas: UMA por paciente. Peso alvo, meta calórica e distribuição de
     macronutrientes — servem de referência para todos os planos dele.

   Grava no localStorage. TROCA POR SUPABASE: único ponto a mexer.
     planos → tabela `planos` (refeicoes em coluna jsonb)
     metas  → tabela `metas` (1 linha por paciente)
   ============================================================ */

'use strict';

const PlanosStore = (() => {

  const CHAVE_PLANOS = 'nutri:planos:v1';
  const CHAVE_METAS = 'nutri:metas:v1';

  /* Estrutura padrão de um dia. O profissional pode renomear, remover ou
     acrescentar refeições depois. */
  const REFEICOES_PADRAO = [
    { nome: 'Café da manhã',   horario: '07:00' },
    { nome: 'Lanche da manhã', horario: '10:00' },
    { nome: 'Almoço',          horario: '12:30' },
    { nome: 'Lanche da tarde', horario: '16:00' },
    { nome: 'Jantar',          horario: '19:30' },
    { nome: 'Ceia',            horario: '21:30' }
  ];

  /* Distribuição inicial de macronutrientes, em % do valor energético.
     Ponto de partida comum; o profissional ajusta por paciente. */
  const MACROS_PADRAO = { pctProteina: 20, pctCarboidrato: 50, pctLipidio: 30 };

  function ler(chave) {
    try {
      const dados = JSON.parse(localStorage.getItem(chave) || '[]');
      return Array.isArray(dados) ? dados : [];
    } catch (e) {
      return [];
    }
  }

  function gravar(chave, lista) {
    try {
      localStorage.setItem(chave, JSON.stringify(lista));
      return true;
    } catch (e) {
      return false;
    }
  }

  function novoId(prefixo) {
    return prefixo + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /* ───────────── Planos ───────────── */

  function refeicoesPadrao() {
    return REFEICOES_PADRAO.map((r) => ({
      id: novoId('r_'),
      nome: r.nome,
      horario: r.horario,
      observacoes: '',
      itens: []
    }));
  }

  async function listarPlanos(pacienteId) {
    return ler(CHAVE_PLANOS)
      .filter((p) => p.pacienteId === pacienteId)
      .sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)));
  }

  async function obterPlano(id) {
    return ler(CHAVE_PLANOS).find((p) => p.id === id) || null;
  }

  async function contarPlanos(pacienteId) {
    return ler(CHAVE_PLANOS).filter((p) => p.pacienteId === pacienteId).length;
  }

  async function salvarPlano(dados) {
    if (!dados.pacienteId) return { ok: false, erro: 'Plano sem paciente vinculado.' };

    const lista = ler(CHAVE_PLANOS);
    const agora = new Date().toISOString();

    const registro = {
      id: dados.id || novoId('pl_'),
      pacienteId: dados.pacienteId,
      nome: String(dados.nome || '').trim() || 'Plano alimentar',
      data: dados.data || agora.slice(0, 10),
      observacoes: String(dados.observacoes || '').trim(),
      refeicoes: (dados.refeicoes || []).map((r) => ({
        id: r.id || novoId('r_'),
        nome: String(r.nome || '').trim() || 'Refeição',
        horario: String(r.horario || '').trim(),
        observacoes: String(r.observacoes || '').trim(),
        itens: (r.itens || []).map((i) => ({
          foodId: i.foodId,
          gramas: Number(i.gramas) || 0,
          medida: String(i.medida || '')
        }))
      })),
      resumo: dados.resumo || {},
      criadoEm: dados.criadoEm || agora,
      atualizadoEm: agora
    };

    const i = lista.findIndex((p) => p.id === registro.id);
    if (i >= 0) {
      registro.criadoEm = lista[i].criadoEm || agora;
      lista[i] = registro;
    } else {
      lista.push(registro);
    }

    if (!gravar(CHAVE_PLANOS, lista)) {
      return { ok: false, erro: 'Não foi possível salvar neste navegador.' };
    }
    return { ok: true, plano: registro };
  }

  async function removerPlano(id) {
    return { ok: gravar(CHAVE_PLANOS, ler(CHAVE_PLANOS).filter((p) => p.id !== id)) };
  }

  /* ───────────── Metas ───────────── */

  async function obterMetas(pacienteId) {
    return ler(CHAVE_METAS).find((m) => m.pacienteId === pacienteId) || null;
  }

  async function salvarMetas(pacienteId, dados) {
    if (!pacienteId) return { ok: false, erro: 'Metas sem paciente.' };

    const lista = ler(CHAVE_METAS);
    const agora = new Date().toISOString();
    const existente = lista.find((m) => m.pacienteId === pacienteId);

    const registro = {
      pacienteId,
      pesoMeta: String(dados.pesoMeta || '').trim(),
      kcalMeta: String(dados.kcalMeta || '').trim(),
      pctProteina: String(dados.pctProteina || '').trim(),
      pctCarboidrato: String(dados.pctCarboidrato || '').trim(),
      pctLipidio: String(dados.pctLipidio || '').trim(),
      observacoes: String(dados.observacoes || '').trim(),
      criadoEm: existente ? existente.criadoEm : agora,
      atualizadoEm: agora
    };

    if (existente) lista[lista.indexOf(existente)] = registro;
    else lista.push(registro);

    if (!gravar(CHAVE_METAS, lista)) {
      return { ok: false, erro: 'Não foi possível salvar neste navegador.' };
    }
    return { ok: true, metas: registro };
  }

  /**
   * Converte a meta em gramas de cada macronutriente.
   * @returns {object|null} null sem meta calórica definida
   */
  function metasEmGramas(metas) {
    if (!metas) return null;
    const kcal = parseFloat(String(metas.kcalMeta).replace(',', '.'));
    if (!isFinite(kcal) || kcal <= 0) return null;

    const pct = (v, padrao) => {
      const n = parseFloat(String(v).replace(',', '.'));
      return isFinite(n) && n >= 0 ? n : padrao;
    };
    const pProt = pct(metas.pctProteina, MACROS_PADRAO.pctProteina);
    const pCarb = pct(metas.pctCarboidrato, MACROS_PADRAO.pctCarboidrato);
    const pLip = pct(metas.pctLipidio, MACROS_PADRAO.pctLipidio);

    return {
      kcal,
      soma: pProt + pCarb + pLip,
      proteinas: { pct: pProt, gramas: (kcal * pProt / 100) / 4 },
      carboidratos: { pct: pCarb, gramas: (kcal * pCarb / 100) / 4 },
      gordurasTotais: { pct: pLip, gramas: (kcal * pLip / 100) / 9 }
    };
  }

  async function removerDoPaciente(pacienteId) {
    const a = gravar(CHAVE_PLANOS, ler(CHAVE_PLANOS).filter((p) => p.pacienteId !== pacienteId));
    const b = gravar(CHAVE_METAS, ler(CHAVE_METAS).filter((m) => m.pacienteId !== pacienteId));
    return { ok: a && b };
  }

  return {
    REFEICOES_PADRAO, MACROS_PADRAO, refeicoesPadrao,
    listarPlanos, obterPlano, contarPlanos, salvarPlano, removerPlano,
    obterMetas, salvarMetas, metasEmGramas, removerDoPaciente
  };
})();
