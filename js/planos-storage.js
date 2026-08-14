/* ============================================================
   planos-storage.js — planos alimentares e metas (tabelas `planos` e `metas`)

   • Plano alimentar: VÁRIOS por paciente. Cada plano tem refeições, e
     cada refeição tem itens (alimento + gramas). A árvore inteira vive
     numa coluna `jsonb` — ela é lida e gravada sempre por inteiro, e
     normalizar isso em três tabelas só criaria junções para montar de
     volta o mesmo objeto.
   • Metas: UMA por paciente (`unique (paciente_id)` no banco). Peso
     alvo, meta calórica e distribuição de macronutrientes — servem de
     referência para todos os planos dele.
   ============================================================ */

'use strict';

const PlanosStore = (() => {

  const COLUNAS_PLANO = 'id, nutricionista_id, paciente_id, nome, data, observacoes, ' +
                        'refeicoes, resumo, visivel_paciente, tipo_dieta, criado_em, atualizado_em';

  const COLUNAS_METAS = 'id, nutricionista_id, paciente_id, peso_meta, kcal_meta, ' +
                        'pct_proteina, pct_carboidrato, pct_lipidio, observacoes, ' +
                        'criado_em, atualizado_em';

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

  /* Os ids de refeição e item vivem dentro do jsonb, então continuam
     sendo gerados aqui — o banco só gera o id da linha do plano. */
  function novoId(prefixo) {
    return prefixo + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function numeroOuNulo(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = parseFloat(String(valor).replace(',', '.').replace(/[^0-9.]/g, ''));
    return isFinite(n) && n >= 0 ? n : null;
  }

  /* As telas de metas escrevem em <input> e comparam com string, então
     o que sai daqui continua string, como era no localStorage. */
  function textoOuVazio(valor) {
    return valor === null || valor === undefined ? '' : String(valor);
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

  function daLinhaPlano(linha) {
    if (!linha) return null;
    return {
      id: linha.id,
      nutricionistaId: linha.nutricionista_id,
      pacienteId: linha.paciente_id,
      nome: linha.nome || '',
      data: linha.data || '',
      observacoes: linha.observacoes || '',
      refeicoes: linha.refeicoes || [],
      resumo: linha.resumo || {},
      visivelPaciente: !!linha.visivel_paciente,
      tipoDieta: linha.tipo_dieta || '',
      criadoEm: linha.criado_em,
      atualizadoEm: linha.atualizado_em
    };
  }

  async function listarPlanos(pacienteId) {
    if (!pacienteId) return [];
    const { data, error } = await Banco.tabela('planos')
      .select(COLUNAS_PLANO)
      .eq('paciente_id', pacienteId)
      .order('atualizado_em', { ascending: false });

    if (error) {
      console.error('listarPlanos:', error);
      return [];
    }
    return (data || []).map(daLinhaPlano);
  }

  async function obterPlano(id) {
    if (!id) return null;
    const { data, error } = await Banco.tabela('planos')
      .select(COLUNAS_PLANO).eq('id', id).maybeSingle();
    return error ? null : daLinhaPlano(data);
  }

  async function contarPlanos(pacienteId) {
    const { count, error } = await Banco.tabela('planos')
      .select('id', { count: 'exact', head: true })
      .eq('paciente_id', pacienteId);
    return error ? 0 : (count || 0);
  }

  async function salvarPlano(dados) {
    if (!dados.pacienteId) return { ok: false, erro: 'Plano sem paciente vinculado.' };

    const campos = {
      paciente_id: dados.pacienteId,
      nome: String(dados.nome || '').trim() || 'Plano alimentar',
      data: dados.data || new Date().toISOString().slice(0, 10),
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
      tipo_dieta: String(dados.tipoDieta || '').trim() || null
    };
    if (dados.visivelPaciente !== undefined) {
      campos.visivel_paciente = !!dados.visivelPaciente;
    }

    if (dados.id) {
      const { data, error } = await Banco.tabela('planos')
        .update(campos).eq('id', dados.id).select(COLUNAS_PLANO);

      if (error) return { ok: false, erro: Banco.traduzirErro(error) };
      if (!data || !data.length) {
        return { ok: false, erro: 'Este plano não está mais disponível para edição.' };
      }
      return { ok: true, plano: daLinhaPlano(data[0]) };
    }

    const nutricionistaId = await Auth.idAtual();
    if (!nutricionistaId) return { ok: false, erro: 'Sua sessão expirou. Entre novamente.' };

    const { data, error } = await Banco.tabela('planos')
      .insert(Object.assign({ nutricionista_id: nutricionistaId }, campos))
      .select(COLUNAS_PLANO);

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    return { ok: true, plano: daLinhaPlano(data[0]) };
  }

  async function removerPlano(id) {
    const { data, error } = await Banco.tabela('planos')
      .delete().eq('id', id).select('id');
    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    return { ok: !!(data && data.length) };
  }

  /* ───────────── Metas ───────────── */

  function daLinhaMetas(linha) {
    if (!linha) return null;
    return {
      pacienteId: linha.paciente_id,
      pesoMeta: textoOuVazio(linha.peso_meta),
      kcalMeta: textoOuVazio(linha.kcal_meta),
      pctProteina: textoOuVazio(linha.pct_proteina),
      pctCarboidrato: textoOuVazio(linha.pct_carboidrato),
      pctLipidio: textoOuVazio(linha.pct_lipidio),
      observacoes: linha.observacoes || '',
      criadoEm: linha.criado_em,
      atualizadoEm: linha.atualizado_em
    };
  }

  async function obterMetas(pacienteId) {
    if (!pacienteId) return null;
    const { data, error } = await Banco.tabela('metas')
      .select(COLUNAS_METAS).eq('paciente_id', pacienteId).maybeSingle();
    return error ? null : daLinhaMetas(data);
  }

  async function salvarMetas(pacienteId, dados) {
    if (!pacienteId) return { ok: false, erro: 'Metas sem paciente.' };

    const nutricionistaId = await Auth.idAtual();
    if (!nutricionistaId) return { ok: false, erro: 'Sua sessão expirou. Entre novamente.' };

    const linha = {
      paciente_id: pacienteId,
      nutricionista_id: nutricionistaId,
      peso_meta: numeroOuNulo(dados.pesoMeta),
      kcal_meta: numeroOuNulo(dados.kcalMeta),
      pct_proteina: numeroOuNulo(dados.pctProteina),
      pct_carboidrato: numeroOuNulo(dados.pctCarboidrato),
      pct_lipidio: numeroOuNulo(dados.pctLipidio),
      observacoes: String(dados.observacoes || '').trim()
    };

    const { data, error } = await Banco.tabela('metas')
      .upsert(linha, { onConflict: 'paciente_id' })
      .select(COLUNAS_METAS);

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    if (!data || !data.length) {
      return { ok: false, erro: 'Estas metas não estão mais disponíveis para edição.' };
    }
    return { ok: true, metas: daLinhaMetas(data[0]) };
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

  /* O banco já apaga tudo junto com o paciente (on delete cascade). */
  async function removerDoPaciente(pacienteId) {
    const a = await Banco.tabela('planos').delete().eq('paciente_id', pacienteId);
    const b = await Banco.tabela('metas').delete().eq('paciente_id', pacienteId);
    return { ok: !a.error && !b.error };
  }

  return {
    REFEICOES_PADRAO, MACROS_PADRAO, refeicoesPadrao,
    listarPlanos, obterPlano, contarPlanos, salvarPlano, removerPlano,
    obterMetas, salvarMetas, metasEmGramas, removerDoPaciente
  };
})();
