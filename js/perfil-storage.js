/* ============================================================
   perfil-storage.js — dados do profissional (tabela `perfis`)

   Existe porque o recibo precisa de um emitente: sem nome, CRN e
   documento, o papel não serve para nada. São dados do usuário logado,
   não de paciente.

   É a mesma linha que o `auth.js` lê para saber o papel da conta —
   `perfis` tem uma linha por `auth.uid()`. Por isso aqui não há
   `nutricionista_id`: a chave primária já é o id do usuário, e a
   política de segurança compara direto com ele.

   O campo `papel` não é gravado por aqui de propósito: quem virou
   nutricionista não deve virar paciente salvando o formulário do
   recibo.
   ============================================================ */

'use strict';

const PerfilStore = (() => {

  const CAMPOS = ['nome', 'crn', 'documento', 'telefone', 'email', 'endereco', 'cidade'];

  async function obterPerfil() {
    const perfil = await Auth.perfilAtual();
    if (!perfil) return null;

    const saida = { atualizadoEm: perfil.atualizado_em };
    CAMPOS.forEach((c) => { saida[c] = perfil[c] || ''; });
    return saida;
  }

  async function salvarPerfil(dados) {
    const id = await Auth.idAtual();
    if (!id) return { ok: false, erro: 'Sua sessão expirou. Entre novamente.' };

    const linha = {};
    CAMPOS.forEach((c) => { linha[c] = String(dados[c] || '').trim(); });

    const { data, error } = await Banco.tabela('perfis')
      .update(linha).eq('id', id).select('*');

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    if (!data || !data.length) {
      return { ok: false, erro: 'Não foi possível salvar seu perfil.' };
    }

    /* O auth.js guarda o perfil em memória por carregamento de página.
       Sem avisar, o cabeçalho continuaria mostrando o nome antigo até
       a próxima navegação. */
    Auth.atualizarPerfilEmCache(data[0]);

    const saida = { atualizadoEm: data[0].atualizado_em };
    CAMPOS.forEach((c) => { saida[c] = data[0][c] || ''; });
    return { ok: true, perfil: saida };
  }

  /** O recibo só faz sentido com, no mínimo, o nome de quem emite. */
  function perfilCompleto(perfil) {
    return !!(perfil && perfil.nome);
  }

  return { CAMPOS, obterPerfil, salvarPerfil, perfilCompleto };
})();
