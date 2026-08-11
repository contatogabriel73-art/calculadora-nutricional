/* ============================================================
   fichas-storage.js — persistência das fichas técnicas salvas

   Cada ficha guardada aqui é um registro fechado, vinculado ao id de
   um paciente. É diferente do rascunho automático que a ferramenta
   mantém enquanto você digita (esse fica em 'calc-nutri:ficha:v2',
   dentro de app.js, e não pertence a paciente nenhum).

   Grava no localStorage — mesmas limitações descritas em
   pacientes-storage.js.

   TROCA POR SUPABASE: único ponto a mexer. Sugestão de tabela `fichas`
   com coluna jsonb para `conteudo`:

     listarFichasDoPaciente(id) → select().eq('paciente_id', id)
     obterFicha(id)             → select().eq('id', id).single()
     salvarFicha(dados)         → upsert(...)
     removerFicha(id)           → delete().eq('id', id)
   ============================================================ */

'use strict';

const FichasStore = (() => {

  const CHAVE = 'nutri:fichas:v1';

  function lerTudo() {
    try {
      const dados = JSON.parse(localStorage.getItem(CHAVE) || '[]');
      return Array.isArray(dados) ? dados : [];
    } catch (e) {
      return [];
    }
  }

  function gravarTudo(lista) {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(lista));
      return true;
    } catch (e) {
      return false;
    }
  }

  function novoId() {
    return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /** Fichas de um paciente, da mais recente para a mais antiga. */
  async function listarFichasDoPaciente(pacienteId) {
    return lerTudo()
      .filter((f) => f.pacienteId === pacienteId)
      .sort((a, b) => String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)));
  }

  async function obterFicha(id) {
    return lerTudo().find((f) => f.id === id) || null;
  }

  async function contarPorPaciente(pacienteId) {
    return lerTudo().filter((f) => f.pacienteId === pacienteId).length;
  }

  /**
   * Cria ou atualiza uma ficha.
   * @param {object} dados { id?, pacienteId, titulo, conteudo, resumo }
   *   `conteudo` guarda o estado completo da ferramenta (campos + ingredientes)
   *   `resumo`   guarda os números já calculados, para a listagem não precisar
   *              recarregar a base TACO e refazer as contas.
   */
  async function salvarFicha(dados) {
    if (!dados.pacienteId) return { ok: false, erro: 'Ficha sem paciente vinculado.' };

    const lista = lerTudo();
    const agora = new Date().toISOString();

    const registro = {
      id: dados.id || novoId(),
      pacienteId: dados.pacienteId,
      titulo: String(dados.titulo || '').trim() || 'Preparação sem nome',
      conteudo: dados.conteudo || {},
      resumo: dados.resumo || {},
      criadoEm: dados.criadoEm || agora,
      atualizadoEm: agora
    };

    const i = lista.findIndex((f) => f.id === registro.id);
    if (i >= 0) {
      registro.criadoEm = lista[i].criadoEm || agora;
      lista[i] = registro;
    } else {
      lista.push(registro);
    }

    if (!gravarTudo(lista)) {
      return { ok: false, erro: 'Não foi possível salvar neste navegador (armazenamento cheio ou bloqueado).' };
    }
    return { ok: true, ficha: registro };
  }

  async function removerFicha(id) {
    return { ok: gravarTudo(lerTudo().filter((f) => f.id !== id)) };
  }

  /** Usado ao excluir um paciente, para não deixar fichas órfãs. */
  async function removerFichasDoPaciente(pacienteId) {
    return { ok: gravarTudo(lerTudo().filter((f) => f.pacienteId !== pacienteId)) };
  }

  return {
    listarFichasDoPaciente, obterFicha, salvarFicha,
    removerFicha, removerFichasDoPaciente, contarPorPaciente
  };
})();
