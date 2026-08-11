/* ============================================================
   pacientes-storage.js — persistência de pacientes

   Hoje grava no localStorage do navegador. Isso significa que os dados
   ficam SÓ naquele aparelho e naquele navegador: não sincronizam, não
   têm backup e somem se o usuário limpar os dados do site.

   TROCA POR SUPABASE: este arquivo é o único ponto a mexer. Mantenha
   as assinaturas e troque o miolo por chamadas à tabela `pacientes`:

     listarPacientes()      → select().order('nome')
     obterPaciente(id)      → select().eq('id', id).single()
     salvarPaciente(dados)  → upsert(dados)
     removerPaciente(id)    → delete().eq('id', id)

   Todas as funções já são assíncronas para que a troca não exija
   alterar quem as chama.
   ============================================================ */

'use strict';

const PacientesStore = (() => {

  const CHAVE = 'nutri:pacientes:v1';

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
      // Cota cheia ou modo privado.
      return false;
    }
  }

  function novoId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /** @returns {Promise<Array>} pacientes em ordem alfabética */
  async function listarPacientes() {
    return lerTudo().sort((a, b) =>
      String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')
    );
  }

  /** @returns {Promise<object|null>} */
  async function obterPaciente(id) {
    return lerTudo().find((p) => p.id === id) || null;
  }

  /**
   * Cria ou atualiza. Sem `id`, cria um novo.
   * @returns {Promise<{ok: boolean, paciente?: object, erro?: string}>}
   */
  async function salvarPaciente(dados) {
    const nome = String(dados.nome || '').trim();
    if (!nome) return { ok: false, erro: 'O nome do paciente é obrigatório.' };

    const lista = lerTudo();
    const agora = new Date().toISOString();

    // `sexo` guarda 'F', 'M' ou '' (não informado). É usado nos pontos de
    // corte de RCQ e circunferência da cintura, que diferem por sexo.
    const sexo = ['F', 'M'].includes(dados.sexo) ? dados.sexo : '';

    const registro = {
      id: dados.id || novoId(),
      nome,
      nascimento: String(dados.nascimento || '').trim(),
      sexo,
      telefone: String(dados.telefone || '').trim(),
      email: String(dados.email || '').trim(),
      observacoes: String(dados.observacoes || '').trim(),
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

    if (!gravarTudo(lista)) {
      return { ok: false, erro: 'Não foi possível salvar neste navegador (armazenamento cheio ou bloqueado).' };
    }
    return { ok: true, paciente: registro };
  }

  /** Remove o paciente. As fichas dele são removidas por quem chama. */
  async function removerPaciente(id) {
    const lista = lerTudo().filter((p) => p.id !== id);
    return { ok: gravarTudo(lista) };
  }

  /** Busca por nome, e-mail ou telefone, ignorando acentos. */
  async function buscarPacientes(termo) {
    const q = String(termo || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
      .trim();

    const todos = await listarPacientes();
    if (!q) return todos;

    return todos.filter((p) => {
      const alvo = (p.nome + ' ' + p.email + ' ' + p.telefone)
        .toLowerCase()
        .normalize('NFD')
        .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
      return alvo.includes(q);
    });
  }

  return { listarPacientes, obterPaciente, salvarPaciente, removerPaciente, buscarPacientes };
})();
