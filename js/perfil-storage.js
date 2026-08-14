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

  /* ───────────── Foto de perfil (Fase 3) ─────────────
     Função separada de salvarPerfil(): aquela reflete o formulário de
     dados do emitente (financeiro.html) e só manda os campos da tela —
     se foto_url estivesse dentro de CAMPOS, salvar o recibo apagaria a
     foto toda vez, porque o formulário não tem esse campo pra mandar.
  */

  const BUCKET_AVATARS = 'avatars';
  const TAMANHO_MAXIMO = 5 * 1024 * 1024;

  /** Só grava a URL já enviada — usado por enviarFoto() logo abaixo. */
  async function salvarFoto(fotoUrl) {
    const id = await Auth.idAtual();
    if (!id) return { ok: false, erro: 'Sua sessão expirou. Entre novamente.' };

    const { data, error } = await Banco.tabela('perfis')
      .update({ foto_url: fotoUrl }).eq('id', id).select('*');

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    if (!data || !data.length) return { ok: false, erro: 'Não foi possível salvar a foto.' };

    Auth.atualizarPerfilEmCache(data[0]);
    return { ok: true, fotoUrl: data[0].foto_url || '' };
  }

  /**
   * Sobe o arquivo pro Supabase Storage (bucket `avatars`) e grava a URL
   * pública em perfis.foto_url. Nunca base64 no banco — foto pesa demais
   * pra caber numa coluna de texto sem inflar toda consulta ao perfil.
   * @param {File} arquivo
   */
  async function enviarFoto(arquivo) {
    if (!arquivo) return { ok: false, erro: 'Nenhum arquivo selecionado.' };
    if (arquivo.size > TAMANHO_MAXIMO) {
      return { ok: false, erro: 'A foto precisa ter até 5 MB.' };
    }

    const id = await Auth.idAtual();
    if (!id) return { ok: false, erro: 'Sua sessão expirou. Entre novamente.' };

    const c = Banco.cx();
    if (!c) return { ok: false, erro: Banco.motivo() };

    // Nome fixo por conta (não o nome original do arquivo): evita
    // acumular lixo no bucket a cada troca de foto, e o prefixo com o
    // próprio id é o que a política de RLS do bucket usa pra restringir
    // cada conta a escrever só na própria pasta (ver supabase/schema.sql).
    const extensao = (arquivo.name.split('.').pop() || 'jpg')
      .toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const caminho = `${id}/avatar.${extensao}`;

    const { error: erroEnvio } = await c.storage.from(BUCKET_AVATARS)
      .upload(caminho, arquivo, { upsert: true, cacheControl: '3600' });
    if (erroEnvio) return { ok: false, erro: Banco.traduzirErro(erroEnvio) };

    const { data } = c.storage.from(BUCKET_AVATARS).getPublicUrl(caminho);
    // O caminho não muda entre uma foto e outra, então sem isto o
    // navegador continuaria mostrando a imagem antiga do próprio cache.
    const url = data.publicUrl + '?t=' + Date.now();

    return salvarFoto(url);
  }

  return {
    CAMPOS, obterPerfil, salvarPerfil, perfilCompleto,
    enviarFoto
  };
})();
