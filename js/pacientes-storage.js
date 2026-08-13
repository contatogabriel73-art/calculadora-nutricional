/* ============================================================
   pacientes-storage.js — persistência de pacientes (tabela `pacientes`)

   As assinaturas são as mesmas de quando isto gravava no localStorage,
   de propósito: as telas que chamam não mudaram uma linha.

   O QUE MUDOU POR BAIXO

   • O `id` agora é um UUID gerado pelo banco, não mais 'p_xyz'. Quem
     salva um paciente novo não manda id nenhum.
   • Toda linha carrega `nutricionista_id`. Não é enfeite: é a coluna
     que a Row Level Security compara com quem está logado, e é o que
     faz um profissional não enxergar o paciente do outro.
   • O banco fala snake_case e as telas falam camelCase. A tradução
     acontece aqui e só aqui.

   ⚠️ POR QUE TODO `update` CONFERE SE VOLTOU LINHA

   Quando a política de segurança barra um update, o Postgres não
   devolve erro: ele filtra a linha antes e a operação termina com
   sucesso, tendo alterado zero linhas. Sem conferir, a tela mostraria
   "Paciente salvo" para uma alteração que o banco descartou em
   silêncio. Por isso todo update pede `.select()` e checa o retorno.
   ============================================================ */

'use strict';

const PacientesStore = (() => {

  /* Colunas pedidas por nome em vez de '*': assim uma coluna nova no
     banco não vaza para a tela sem alguém decidir que ela deve ir. */
  const COLUNAS = 'id, nutricionista_id, usuario_id, codigo_convite, nome, ' +
                  'nascimento, sexo, telefone, email, observacoes, criado_em, atualizado_em';

  /** Linha do banco → objeto que as telas já esperavam. */
  function daLinha(linha) {
    if (!linha) return null;
    return {
      id: linha.id,
      nutricionistaId: linha.nutricionista_id,
      usuarioId: linha.usuario_id || '',
      codigoConvite: linha.codigo_convite || '',
      nome: linha.nome || '',
      nascimento: linha.nascimento || '',
      sexo: linha.sexo || '',
      telefone: linha.telefone || '',
      email: linha.email || '',
      observacoes: linha.observacoes || '',
      criadoEm: linha.criado_em,
      atualizadoEm: linha.atualizado_em
    };
  }

  /** Objeto da tela → colunas do banco. */
  function paraLinha(dados) {
    return {
      nome: String(dados.nome || '').trim(),
      // `date` no Postgres não aceita string vazia; sem data é null.
      nascimento: String(dados.nascimento || '').trim() || null,
      // 'F', 'M' ou '' (não informado) — usado nos pontos de corte de
      // RCQ e cintura, que diferem por sexo.
      sexo: ['F', 'M'].includes(dados.sexo) ? dados.sexo : '',
      telefone: String(dados.telefone || '').trim(),
      email: String(dados.email || '').trim(),
      observacoes: String(dados.observacoes || '').trim()
    };
  }

  /** @returns {Promise<Array>} pacientes em ordem alfabética */
  async function listarPacientes() {
    const { data, error } = await Banco.tabela('pacientes')
      .select(COLUNAS)
      .order('nome', { ascending: true });

    if (error) {
      console.error('listarPacientes:', error);
      return [];
    }
    return (data || []).map(daLinha);
  }

  /** @returns {Promise<object|null>} */
  async function obterPaciente(id) {
    if (!id) return null;
    const { data, error } = await Banco.tabela('pacientes')
      .select(COLUNAS)
      .eq('id', id)
      .maybeSingle();

    return error ? null : daLinha(data);
  }

  /**
   * Cria ou atualiza. Sem `id`, cria um novo.
   * @returns {Promise<{ok: boolean, paciente?: object, erro?: string}>}
   */
  async function salvarPaciente(dados) {
    const campos = paraLinha(dados);
    if (!campos.nome) return { ok: false, erro: 'O nome do paciente é obrigatório.' };

    if (dados.id) {
      const { data, error } = await Banco.tabela('pacientes')
        .update(campos)
        .eq('id', dados.id)
        .select(COLUNAS);

      if (error) return { ok: false, erro: Banco.traduzirErro(error) };
      if (!data || !data.length) {
        // Zero linhas: ou sumiu, ou é de outro profissional. A política
        // de segurança não diferencia os dois casos de propósito —
        // dizer "existe, mas não é seu" já entrega informação.
        return { ok: false, erro: 'Este paciente não está mais disponível para edição.' };
      }
      return { ok: true, paciente: daLinha(data[0]) };
    }

    const nutricionistaId = await Auth.idAtual();
    if (!nutricionistaId) return { ok: false, erro: 'Sua sessão expirou. Entre novamente.' };

    const { data, error } = await Banco.tabela('pacientes')
      .insert(Object.assign({ nutricionista_id: nutricionistaId }, campos))
      .select(COLUNAS);

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    return { ok: true, paciente: daLinha(data[0]) };
  }

  /**
   * Remove o paciente. Consultas, pagamentos, avaliações, fichas e
   * planos dele saem junto — as chaves estrangeiras estão em
   * `on delete cascade`, então isso acontece no banco, numa transação
   * só. Antes era responsabilidade de quem chamava apagar cada coisa,
   * e bastava uma falha no meio para sobrar registro órfão.
   */
  async function removerPaciente(id) {
    const { data, error } = await Banco.tabela('pacientes')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    return { ok: !!(data && data.length) };
  }

  /**
   * Busca por nome, e-mail ou telefone, ignorando acentos.
   *
   * O filtro roda aqui e não no banco de propósito: `ilike` do Postgres
   * respeita acento, então "jose" não acharia "José". A carteira de um
   * consultório é de dezenas a poucos milhares de pacientes — filtrar
   * essa lista no navegador é instantâneo e acha o que a pessoa quis.
   */
  async function buscarPacientes(termo) {
    const semAcento = (txt) => String(txt || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');

    const q = semAcento(termo).trim();
    const todos = await listarPacientes();
    if (!q) return todos;

    return todos.filter((p) =>
      semAcento(p.nome + ' ' + p.email + ' ' + p.telefone).includes(q));
  }

  return { listarPacientes, obterPaciente, salvarPaciente, removerPaciente, buscarPacientes };
})();
