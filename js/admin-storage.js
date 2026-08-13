/* ============================================================
   admin-storage.js — aprovação manual de cadastro de nutricionista

   Só funciona para quem tem `papel_admin = true` na própria linha de
   `perfis` — as políticas de RLS (perfis_admin_le_tudo,
   perfis_admin_atualiza) são o que realmente impede qualquer outra
   conta de listar ou aprovar cadastro alheio; a página admin.html
   também confere isso, mas é a política do banco que protege de
   verdade.
   ============================================================ */

'use strict';

const AdminStore = (() => {

  const COLUNAS = 'id, nome, email, crn, cpf, cidade, estado, status_verificacao, criado_em';

  function daLinha(linha) {
    if (!linha) return null;
    return {
      id: linha.id,
      nome: linha.nome || '',
      email: linha.email || '',
      crn: linha.crn || '',
      cpf: linha.cpf || '',
      cidade: linha.cidade || '',
      estado: linha.estado || '',
      statusVerificacao: linha.status_verificacao,
      criadoEm: linha.criado_em
    };
  }

  /** Nutricionistas aguardando revisão, do cadastro mais antigo para o mais novo. */
  async function listarPendentes() {
    const { data, error } = await Banco.tabela('perfis')
      .select(COLUNAS)
      .eq('papel', 'nutricionista')
      .eq('status_verificacao', 'pendente')
      .order('criado_em', { ascending: true });

    if (error) {
      console.error('listarPendentes:', error);
      return [];
    }
    return (data || []).map(daLinha);
  }

  /** Já revisados — aprovados e recusados, do mais recente para o mais antigo. */
  async function listarRevisados() {
    const { data, error } = await Banco.tabela('perfis')
      .select(COLUNAS)
      .eq('papel', 'nutricionista')
      .in('status_verificacao', ['verificado', 'recusado'])
      .order('criado_em', { ascending: false })
      .limit(50);

    if (error) {
      console.error('listarRevisados:', error);
      return [];
    }
    return (data || []).map(daLinha);
  }

  async function definirStatus(id, status) {
    const { data, error } = await Banco.tabela('perfis')
      .update({ status_verificacao: status })
      .eq('id', id)
      .select(COLUNAS);

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    if (!data || !data.length) {
      return { ok: false, erro: 'Não foi possível encontrar este cadastro para atualizar.' };
    }
    return { ok: true, perfil: daLinha(data[0]) };
  }

  const aprovar = (id) => definirStatus(id, 'verificado');
  const recusar = (id) => definirStatus(id, 'recusado');

  return { listarPendentes, listarRevisados, aprovar, recusar };
})();
