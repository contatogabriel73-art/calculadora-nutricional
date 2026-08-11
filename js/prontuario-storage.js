/* ============================================================
   prontuario-storage.js — anamnese e avaliações antropométricas

   Duas coisas com naturezas diferentes:

   • Anamnese: UMA por paciente, editável. É o retrato do histórico de
     saúde, que se atualiza em vez de acumular versões.
   • Avaliação antropométrica: VÁRIAS por paciente, uma por data. É
     justamente a série ao longo do tempo que interessa.

   Grava no localStorage. TROCA POR SUPABASE: único ponto a mexer,
   mantendo as assinaturas (já assíncronas).
     obterAnamnese / salvarAnamnese  → tabela `anamneses` (1 por paciente)
     listarAvaliacoes / salvarAvaliacao / removerAvaliacao → `avaliacoes`
   ============================================================ */

'use strict';

const ProntuarioStore = (() => {

  const CHAVE_ANAMNESE = 'nutri:anamneses:v1';
  const CHAVE_AVALIACOES = 'nutri:avaliacoes:v1';

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

  /* ───────────── Anamnese ───────────── */

  const CAMPOS_ANAMNESE = [
    'historicoSaude', 'medicamentos', 'queixas', 'habitos',
    'restricoes', 'alergias', 'atividadeFisica', 'sono',
    'hidratacao', 'funcionamentoIntestinal', 'observacoes'
  ];

  async function obterAnamnese(pacienteId) {
    return ler(CHAVE_ANAMNESE).find((a) => a.pacienteId === pacienteId) || null;
  }

  async function salvarAnamnese(pacienteId, dados) {
    if (!pacienteId) return { ok: false, erro: 'Anamnese sem paciente.' };

    const lista = ler(CHAVE_ANAMNESE);
    const agora = new Date().toISOString();
    const existente = lista.find((a) => a.pacienteId === pacienteId);

    const registro = {
      id: existente ? existente.id : novoId('an_'),
      pacienteId,
      criadoEm: existente ? existente.criadoEm : agora,
      atualizadoEm: agora
    };
    CAMPOS_ANAMNESE.forEach((c) => { registro[c] = String(dados[c] || '').trim(); });

    if (existente) lista[lista.indexOf(existente)] = registro;
    else lista.push(registro);

    if (!gravar(CHAVE_ANAMNESE, lista)) {
      return { ok: false, erro: 'Não foi possível salvar neste navegador.' };
    }
    return { ok: true, anamnese: registro };
  }

  /** true se a anamnese tem algum campo preenchido. */
  function anamnesePreenchida(anamnese) {
    if (!anamnese) return false;
    return CAMPOS_ANAMNESE.some((c) => (anamnese[c] || '').trim() !== '');
  }

  /* ───────────── Avaliações antropométricas ───────────── */

  /** Da mais recente para a mais antiga. */
  async function listarAvaliacoes(pacienteId) {
    return ler(CHAVE_AVALIACOES)
      .filter((a) => a.pacienteId === pacienteId)
      .sort((a, b) => String(b.data).localeCompare(String(a.data)));
  }

  /** Da mais antiga para a mais recente — ordem de gráfico e de evolução. */
  async function listarAvaliacoesCronologicas(pacienteId) {
    return (await listarAvaliacoes(pacienteId)).slice().reverse();
  }

  async function obterAvaliacao(id) {
    return ler(CHAVE_AVALIACOES).find((a) => a.id === id) || null;
  }

  async function contarAvaliacoes(pacienteId) {
    return ler(CHAVE_AVALIACOES).filter((a) => a.pacienteId === pacienteId).length;
  }

  async function salvarAvaliacao(dados) {
    if (!dados.pacienteId) return { ok: false, erro: 'Avaliação sem paciente.' };
    if (!dados.data) return { ok: false, erro: 'Informe a data da avaliação.' };

    const lista = ler(CHAVE_AVALIACOES);
    const agora = new Date().toISOString();

    const registro = {
      id: dados.id || novoId('av_'),
      pacienteId: dados.pacienteId,
      data: dados.data,
      peso: dados.peso || '',
      altura: dados.altura || '',
      circunferencias: Object.assign({}, dados.circunferencias || {}),
      dobras: Object.assign({}, dados.dobras || {}),
      observacoes: String(dados.observacoes || '').trim(),
      criadoEm: dados.criadoEm || agora,
      atualizadoEm: agora
    };

    const i = lista.findIndex((a) => a.id === registro.id);
    if (i >= 0) {
      registro.criadoEm = lista[i].criadoEm || agora;
      lista[i] = registro;
    } else {
      lista.push(registro);
    }

    if (!gravar(CHAVE_AVALIACOES, lista)) {
      return { ok: false, erro: 'Não foi possível salvar neste navegador.' };
    }
    return { ok: true, avaliacao: registro };
  }

  async function removerAvaliacao(id) {
    return { ok: gravar(CHAVE_AVALIACOES, ler(CHAVE_AVALIACOES).filter((a) => a.id !== id)) };
  }

  /** Chamado ao excluir um paciente, para não deixar registro órfão. */
  async function removerDoPaciente(pacienteId) {
    const a = gravar(CHAVE_ANAMNESE, ler(CHAVE_ANAMNESE).filter((x) => x.pacienteId !== pacienteId));
    const b = gravar(CHAVE_AVALIACOES, ler(CHAVE_AVALIACOES).filter((x) => x.pacienteId !== pacienteId));
    return { ok: a && b };
  }

  return {
    CAMPOS_ANAMNESE,
    obterAnamnese, salvarAnamnese, anamnesePreenchida,
    listarAvaliacoes, listarAvaliacoesCronologicas, obterAvaliacao,
    contarAvaliacoes, salvarAvaliacao, removerAvaliacao, removerDoPaciente
  };
})();
