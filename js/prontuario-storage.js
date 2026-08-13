/* ============================================================
   prontuario-storage.js — anamnese e avaliações antropométricas

   Duas coisas com naturezas diferentes, e é por isso que são duas
   tabelas:

   • Anamnese (`anamneses`): UMA por paciente, editável. É o retrato do
     histórico de saúde, que se atualiza em vez de acumular versões —
     alergia e cirurgia antiga não mudam a cada consulta. O
     `unique (paciente_id)` no banco é o que garante isso.

   • Avaliação (`avaliacoes`): VÁRIAS por paciente, uma por data, e cada
     consulta cria um registro NOVO. Nunca sobrescreve. É justamente a
     série ao longo do tempo que vira o gráfico de evolução.

   Quem lê o quê: o paciente enxerga as próprias avaliações (é o "antes
   e depois" dele), mas NÃO a anamnese — ela tem anotação clínica
   escrita para o profissional, com termos que fora de contexto
   assustam. Isso está nas políticas do banco, não aqui.

   Mudança de tipo: `peso` e `altura` agora são numéricos no banco, não
   texto. Voltam como número (ou '' quando em branco); `Antropometria.num()`
   aceita os dois, então as telas não mudaram.
   ============================================================ */

'use strict';

const ProntuarioStore = (() => {

  /* Nomes em camelCase que as telas usam, e a coluna correspondente.
     A lista existe uma vez só e serve para ler, gravar e para o
     `CAMPOS_ANAMNESE` que a tela de prontuário percorre. */
  const MAPA_ANAMNESE = {
    historicoSaude: 'historico_saude',
    medicamentos: 'medicamentos',
    queixas: 'queixas',
    habitos: 'habitos',
    restricoes: 'restricoes',
    alergias: 'alergias',
    atividadeFisica: 'atividade_fisica',
    sono: 'sono',
    hidratacao: 'hidratacao',
    funcionamentoIntestinal: 'funcionamento_intestinal',
    observacoes: 'observacoes'
  };

  const CAMPOS_ANAMNESE = Object.keys(MAPA_ANAMNESE);

  const COLUNAS_ANAMNESE = 'id, paciente_id, ' +
    Object.values(MAPA_ANAMNESE).join(', ') + ', criado_em, atualizado_em';

  const COLUNAS_AVALIACAO = 'id, nutricionista_id, paciente_id, data, peso, altura, ' +
                            'circunferencias, dobras, observacoes, criado_em, atualizado_em';

  /* Campo numérico vazio precisa virar null: coluna `numeric` não
     aceita string vazia, e 0 significaria "pesa zero". */
  function numeroOuNulo(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = parseFloat(String(valor).replace(',', '.').replace(/[^0-9.]/g, ''));
    return isFinite(n) && n > 0 ? n : null;
  }

  function numeroOuVazio(valor) {
    return valor === null || valor === undefined ? '' : Number(valor);
  }

  /* ───────────── Anamnese ───────────── */

  function daLinhaAnamnese(linha) {
    if (!linha) return null;
    const saida = {
      id: linha.id,
      pacienteId: linha.paciente_id,
      criadoEm: linha.criado_em,
      atualizadoEm: linha.atualizado_em
    };
    CAMPOS_ANAMNESE.forEach((c) => { saida[c] = linha[MAPA_ANAMNESE[c]] || ''; });
    return saida;
  }

  async function obterAnamnese(pacienteId) {
    if (!pacienteId) return null;
    const { data, error } = await Banco.tabela('anamneses')
      .select(COLUNAS_ANAMNESE)
      .eq('paciente_id', pacienteId)
      .maybeSingle();
    return error ? null : daLinhaAnamnese(data);
  }

  async function salvarAnamnese(pacienteId, dados) {
    if (!pacienteId) return { ok: false, erro: 'Anamnese sem paciente.' };

    const nutricionistaId = await Auth.idAtual();
    if (!nutricionistaId) return { ok: false, erro: 'Sua sessão expirou. Entre novamente.' };

    const linha = { paciente_id: pacienteId, nutricionista_id: nutricionistaId };
    CAMPOS_ANAMNESE.forEach((c) => {
      linha[MAPA_ANAMNESE[c]] = String(dados[c] || '').trim();
    });

    /* upsert com onConflict no paciente: é o que faz "uma anamnese por
       paciente" sem precisar consultar antes para decidir entre insert
       e update — e sem a corrida entre as duas operações. */
    const { data, error } = await Banco.tabela('anamneses')
      .upsert(linha, { onConflict: 'paciente_id' })
      .select(COLUNAS_ANAMNESE);

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    if (!data || !data.length) {
      return { ok: false, erro: 'Esta anamnese não está mais disponível para edição.' };
    }
    return { ok: true, anamnese: daLinhaAnamnese(data[0]) };
  }

  /** true se a anamnese tem algum campo preenchido. */
  function anamnesePreenchida(anamnese) {
    if (!anamnese) return false;
    return CAMPOS_ANAMNESE.some((c) => (anamnese[c] || '').trim() !== '');
  }

  /* ───────────── Avaliações antropométricas ───────────── */

  function daLinhaAvaliacao(linha) {
    if (!linha) return null;
    return {
      id: linha.id,
      nutricionistaId: linha.nutricionista_id,
      pacienteId: linha.paciente_id,
      data: linha.data,
      peso: numeroOuVazio(linha.peso),
      altura: numeroOuVazio(linha.altura),
      circunferencias: linha.circunferencias || {},
      dobras: linha.dobras || {},
      observacoes: linha.observacoes || '',
      criadoEm: linha.criado_em,
      atualizadoEm: linha.atualizado_em
    };
  }

  /** Da mais recente para a mais antiga. */
  async function listarAvaliacoes(pacienteId) {
    if (!pacienteId) return [];
    const { data, error } = await Banco.tabela('avaliacoes')
      .select(COLUNAS_AVALIACAO)
      .eq('paciente_id', pacienteId)
      .order('data', { ascending: false });

    if (error) {
      console.error('listarAvaliacoes:', error);
      return [];
    }
    return (data || []).map(daLinhaAvaliacao);
  }

  /** Da mais antiga para a mais recente — ordem de gráfico e de evolução. */
  async function listarAvaliacoesCronologicas(pacienteId) {
    return (await listarAvaliacoes(pacienteId)).slice().reverse();
  }

  async function obterAvaliacao(id) {
    if (!id) return null;
    const { data, error } = await Banco.tabela('avaliacoes')
      .select(COLUNAS_AVALIACAO).eq('id', id).maybeSingle();
    return error ? null : daLinhaAvaliacao(data);
  }

  async function contarAvaliacoes(pacienteId) {
    const { count, error } = await Banco.tabela('avaliacoes')
      .select('id', { count: 'exact', head: true })
      .eq('paciente_id', pacienteId);
    return error ? 0 : (count || 0);
  }

  async function salvarAvaliacao(dados) {
    if (!dados.pacienteId) return { ok: false, erro: 'Avaliação sem paciente.' };
    if (!dados.data) return { ok: false, erro: 'Informe a data da avaliação.' };

    const campos = {
      paciente_id: dados.pacienteId,
      data: dados.data,
      peso: numeroOuNulo(dados.peso),
      altura: numeroOuNulo(dados.altura),
      circunferencias: Object.assign({}, dados.circunferencias || {}),
      dobras: Object.assign({}, dados.dobras || {}),
      observacoes: String(dados.observacoes || '').trim()
    };

    if (dados.id) {
      const { data, error } = await Banco.tabela('avaliacoes')
        .update(campos).eq('id', dados.id).select(COLUNAS_AVALIACAO);

      if (error) return { ok: false, erro: Banco.traduzirErro(error) };
      if (!data || !data.length) {
        return { ok: false, erro: 'Esta avaliação não está mais disponível para edição.' };
      }
      return { ok: true, avaliacao: daLinhaAvaliacao(data[0]) };
    }

    const nutricionistaId = await Auth.idAtual();
    if (!nutricionistaId) return { ok: false, erro: 'Sua sessão expirou. Entre novamente.' };

    const { data, error } = await Banco.tabela('avaliacoes')
      .insert(Object.assign({ nutricionista_id: nutricionistaId }, campos))
      .select(COLUNAS_AVALIACAO);

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    return { ok: true, avaliacao: daLinhaAvaliacao(data[0]) };
  }

  async function removerAvaliacao(id) {
    const { data, error } = await Banco.tabela('avaliacoes')
      .delete().eq('id', id).select('id');
    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    return { ok: !!(data && data.length) };
  }

  /* O banco já apaga tudo junto com o paciente (on delete cascade). */
  async function removerDoPaciente(pacienteId) {
    const a = await Banco.tabela('anamneses').delete().eq('paciente_id', pacienteId);
    const b = await Banco.tabela('avaliacoes').delete().eq('paciente_id', pacienteId);
    return { ok: !a.error && !b.error };
  }

  return {
    CAMPOS_ANAMNESE,
    obterAnamnese, salvarAnamnese, anamnesePreenchida,
    listarAvaliacoes, listarAvaliacoesCronologicas, obterAvaliacao,
    contarAvaliacoes, salvarAvaliacao, removerAvaliacao, removerDoPaciente
  };
})();
