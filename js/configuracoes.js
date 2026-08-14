/* ============================================================
   configuracoes.js — "Configurações da conta"

   Mesmo padrão de campos e mesma PerfilStore que financeiro.html já
   usa em "Dados para o recibo" — os dois formulários editam a mesma
   linha em `perfis`, só que este também deixa trocar a foto.
   ============================================================ */

'use strict';

(async () => {
  if (!(await Auth.exigirLogin('nutricionista'))) return;
  await Shell.montarCabecalho('');

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const btnAvatar = $('#btn-avatar-config');
  const btnTrocarFoto = $('#btn-trocar-foto');
  const inputFoto = $('#input-foto-config');

  function desenharAvatar(usuario) {
    const fotoUrl = (usuario.perfil && usuario.perfil.foto_url) || '';
    btnAvatar.innerHTML = fotoUrl
      ? `<img src="${Shell.escapar(fotoUrl)}" alt="">`
      : `<span aria-hidden="true">${Shell.iniciais(usuario.nome)}</span>`;
  }

  const usuarioAtual = await Auth.usuarioAtual();
  if (usuarioAtual) desenharAvatar(usuarioAtual);

  function abrirSeletorFoto() { inputFoto.click(); }
  btnAvatar.addEventListener('click', abrirSeletorFoto);
  btnTrocarFoto.addEventListener('click', abrirSeletorFoto);

  inputFoto.addEventListener('change', async () => {
    const arquivo = inputFoto.files[0];
    inputFoto.value = '';
    if (!arquivo) return;

    btnAvatar.disabled = true;
    const resultado = await PerfilStore.enviarFoto(arquivo);
    btnAvatar.disabled = false;

    if (!resultado.ok) { Shell.toast(resultado.erro); return; }
    btnAvatar.innerHTML = `<img src="${Shell.escapar(resultado.fotoUrl)}" alt="">`;
    Shell.toast('Foto atualizada.');
  });

  /* ───────────── Meus dados ───────────── */

  async function carregarPerfil() {
    const perfil = await PerfilStore.obterPerfil();
    $$('[data-perfil]').forEach((i) => { i.value = perfil ? (perfil[i.dataset.perfil] || '') : ''; });
    $('#perfil-estado').textContent = PerfilStore.perfilCompleto(perfil) ? 'Preenchido' : '';
  }

  $('#form-perfil').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const dados = {};
    $$('[data-perfil]').forEach((i) => { dados[i.dataset.perfil] = i.value; });

    if (!dados.nome.trim()) { Shell.toast('O nome é obrigatório.'); return; }

    const resultado = await PerfilStore.salvarPerfil(dados);
    if (!resultado.ok) { Shell.toast(resultado.erro); return; }
    $('#perfil-estado').textContent = 'Preenchido';
    Shell.toast('Dados salvos.');
  });

  await carregarPerfil();
})();
