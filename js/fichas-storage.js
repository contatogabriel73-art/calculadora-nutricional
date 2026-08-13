/* ============================================================
   fichas-storage.js — fichas técnicas salvas (tabela `fichas_tecnicas`)

   Cada ficha guardada aqui é um registro fechado, vinculado a um
   paciente. É diferente do rascunho automático que a ferramenta mantém
   enquanto você digita (esse fica em 'calc-nutri:ficha:v2', dentro de
   app.js, no localStorage, e não pertence a paciente nenhum) — esse
   continua local de propósito: é rascunho, não prontuário.

   `conteudo` guarda o estado completo da ferramenta (campos +
   ingredientes) e `resumo` os números já calculados, para a listagem
   não precisar recarregar a base TACO e refazer as contas. Os dois são
   `jsonb` no banco, então vão e voltam como objeto.

   `visivelPaciente` decide se o paciente enxerga a ficha na área dele.
   Nasce falso: ficha em rascunho não vaza. Quem usa isso é a Fase 5.
   ============================================================ */

'use strict';

const FichasStore = (() => {

  const COLUNAS = 'id, nutricionista_id, paciente_id, titulo, conteudo, resumo, ' +
                  'visivel_paciente, criado_em, atualizado_em';

  function daLinha(linha) {
    if (!linha) return null;
    return {
      id: linha.id,
      nutricionistaId: linha.nutricionista_id,
      pacienteId: linha.paciente_id,
      titulo: linha.titulo || '',
      conteudo: linha.conteudo || {},
      resumo: linha.resumo || {},
      visivelPaciente: !!linha.visivel_paciente,
      criadoEm: linha.criado_em,
      atualizadoEm: linha.atualizado_em
    };
  }

  /** Fichas de um paciente, da mais recente para a mais antiga. */
  async function listarFichasDoPaciente(pacienteId) {
    if (!pacienteId) return [];
    const { data, error } = await Banco.tabela('fichas_tecnicas')
      .select(COLUNAS)
      .eq('paciente_id', pacienteId)
      .order('atualizado_em', { ascending: false });

    if (error) {
      console.error('listarFichasDoPaciente:', error);
      return [];
    }
    return (data || []).map(daLinha);
  }

  async function obterFicha(id) {
    if (!id) return null;
    const { data, error } = await Banco.tabela('fichas_tecnicas')
      .select(COLUNAS).eq('id', id).maybeSingle();
    return error ? null : daLinha(data);
  }

  async function contarPorPaciente(pacienteId) {
    const { count, error } = await Banco.tabela('fichas_tecnicas')
      .select('id', { count: 'exact', head: true })
      .eq('paciente_id', pacienteId);
    return error ? 0 : (count || 0);
  }

  /**
   * Cria ou atualiza uma ficha.
   * @param {object} dados { id?, pacienteId, titulo, conteudo, resumo, visivelPaciente? }
   */
  async function salvarFicha(dados) {
    if (!dados.pacienteId) return { ok: false, erro: 'Ficha sem paciente vinculado.' };

    const campos = {
      paciente_id: dados.pacienteId,
      titulo: String(dados.titulo || '').trim() || 'Preparação sem nome',
      conteudo: dados.conteudo || {},
      resumo: dados.resumo || {}
    };
    // Só mexe na visibilidade quando quem chama tocou no assunto —
    // senão salvar uma ficha já liberada a esconderia sem querer.
    if (dados.visivelPaciente !== undefined) {
      campos.visivel_paciente = !!dados.visivelPaciente;
    }

    if (dados.id) {
      const { data, error } = await Banco.tabela('fichas_tecnicas')
        .update(campos).eq('id', dados.id).select(COLUNAS);

      if (error) return { ok: false, erro: Banco.traduzirErro(error) };
      if (!data || !data.length) {
        return { ok: false, erro: 'Esta ficha não está mais disponível para edição.' };
      }
      return { ok: true, ficha: daLinha(data[0]) };
    }

    const nutricionistaId = await Auth.idAtual();
    if (!nutricionistaId) return { ok: false, erro: 'Sua sessão expirou. Entre novamente.' };

    const { data, error } = await Banco.tabela('fichas_tecnicas')
      .insert(Object.assign({ nutricionista_id: nutricionistaId }, campos))
      .select(COLUNAS);

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    return { ok: true, ficha: daLinha(data[0]) };
  }

  async function removerFicha(id) {
    const { data, error } = await Banco.tabela('fichas_tecnicas')
      .delete().eq('id', id).select('id');
    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    return { ok: !!(data && data.length) };
  }

  /* O banco já apaga junto com o paciente (on delete cascade). */
  async function removerFichasDoPaciente(pacienteId) {
    const { error } = await Banco.tabela('fichas_tecnicas')
      .delete().eq('paciente_id', pacienteId);
    return { ok: !error };
  }

  return {
    listarFichasDoPaciente, obterFicha, salvarFicha,
    removerFicha, removerFichasDoPaciente, contarPorPaciente
  };
})();
