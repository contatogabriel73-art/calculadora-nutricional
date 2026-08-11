/* ============================================================
   perfil-storage.js — dados do profissional

   Existe porque o recibo precisa de um emitente: sem nome, CRN e
   documento, o papel não serve para nada. São dados do usuário logado,
   não de paciente.

   TROCA POR SUPABASE: vira o registro do próprio usuário
   (tabela `perfis`, uma linha por auth.uid()).
   ============================================================ */

'use strict';

const PerfilStore = (() => {

  const CHAVE = 'nutri:perfil:v1';

  const CAMPOS = ['nome', 'crn', 'documento', 'telefone', 'email', 'endereco', 'cidade'];

  function ler() {
    try {
      return JSON.parse(localStorage.getItem(CHAVE) || 'null');
    } catch (e) {
      return null;
    }
  }

  async function obterPerfil() {
    return ler();
  }

  async function salvarPerfil(dados) {
    const registro = { atualizadoEm: new Date().toISOString() };
    CAMPOS.forEach((c) => { registro[c] = String(dados[c] || '').trim(); });

    try {
      localStorage.setItem(CHAVE, JSON.stringify(registro));
    } catch (e) {
      return { ok: false, erro: 'Não foi possível salvar neste navegador.' };
    }
    return { ok: true, perfil: registro };
  }

  /** O recibo só faz sentido com, no mínimo, o nome de quem emite. */
  function perfilCompleto(perfil) {
    return !!(perfil && perfil.nome);
  }

  return { CAMPOS, obterPerfil, salvarPerfil, perfilCompleto };
})();
