/* ============================================================
   shell.js — casca comum das telas internas

   Monta o cabeçalho com navegação e logout, protege a página contra
   acesso sem login e oferece utilidades usadas por mais de uma tela
   (escapar HTML, formatar datas, toast).

   Sem build system não há templates, então o cabeçalho é gerado aqui
   em vez de repetido em cada arquivo HTML.
   ============================================================ */

'use strict';

const Shell = (() => {

  function escapar(txt) {
    return String(txt == null ? '' : txt).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** "1990-05-23" → "23/05/1990". Devolve '' para entrada vazia/inválida. */
  function formatarData(iso) {
    if (!iso) return '';
    const partes = String(iso).slice(0, 10).split('-');
    if (partes.length !== 3) return '';
    const [a, m, d] = partes;
    if (!a || !m || !d) return '';
    return `${d}/${m}/${a}`;
  }

  /** Data e hora de um timestamp ISO, no formato brasileiro. */
  function formatarDataHora(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  /** Idade em anos a partir da data de nascimento. null se não der para calcular. */
  function calcularIdade(nascimento) {
    if (!nascimento) return null;
    const nasc = new Date(nascimento + 'T00:00:00');
    if (isNaN(nasc)) return null;
    const hoje = new Date();
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    return idade >= 0 && idade < 130 ? idade : null;
  }

  /** Iniciais para o avatar da listagem: "Maria Silva" → "MS". */
  function iniciais(nome) {
    const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  let timerToast;
  function toast(msg) {
    let elemento = document.querySelector('#toast');
    if (!elemento) {
      elemento = document.createElement('div');
      elemento.id = 'toast';
      elemento.className = 'toast';
      elemento.setAttribute('role', 'status');
      elemento.setAttribute('aria-live', 'polite');
      document.body.appendChild(elemento);
    }
    elemento.textContent = msg;
    elemento.classList.add('visivel');
    clearTimeout(timerToast);
    timerToast = setTimeout(() => elemento.classList.remove('visivel'), 2600);
  }

  const MARCA_SVG = `
    <svg class="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="currentColor"/>
      <path d="M15 12v10a4 4 0 0 0 4 4h0v10a2 2 0 0 0 4 0V26a4 4 0 0 0 4-4V12" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M21 12v8M33 12c3 2 4 6 4 10s-1 5-3 5v9a2 2 0 1 1-4 0V15z" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  /* Ícones da sidebar — mesmo estilo de traço fino usado nos ícones da
     landing (stroke, sem preenchimento), um por item de navegação. */
  const ICONES = {
    painel: '<path d="M4 13h6V4H4v9zM14 20h6v-9h-6v9zM14 4v5h6V4h-6zM4 20h6v-5H4v5z"/>',
    pacientes: '<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    agenda: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    financeiro: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>',
    ficha: '<path d="M9 3h6a1 1 0 0 1 1 1v1h1a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1V4a1 1 0 0 1 1-1z"/><path d="M9 12h6M9 16h6"/>',
    admin: '<path d="M12 3l8 3v6c0 4.5-3 8-8 9-5-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    inicio: '<path d="M4 12l8-8 8 8"/><path d="M6 10v10h12V10"/>'
  };

  function icone(id) {
    return `<svg class="item-sidebar-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[id] || ICONES.painel}</svg>`;
  }

  /* A navegação muda por papel. Mesma casca, mesmo verde, mesma marca —
     o que muda é o que cada um tem para fazer ali dentro.

     O paciente não recebe uma versão reduzida do menu do profissional:
     recebe o menu dele. Financeiro e ficha técnica não são seções que ele
     "ainda não pode" abrir; são ferramentas de consultório que não fazem
     parte do que ele veio ver. */
  const NAVEGACAO = {
    nutricionista: {
      sub: 'Plataforma para nutricionistas',
      inicio: 'painel.html',
      abas: [
        { id: 'painel',     href: 'painel.html',     rotulo: 'Painel' },
        { id: 'pacientes',  href: 'pacientes.html',  rotulo: 'Pacientes' },
        { id: 'agenda',     href: 'agenda.html',     rotulo: 'Agenda' },
        { id: 'financeiro', href: 'financeiro.html', rotulo: 'Financeiro' },
        { id: 'ficha',      href: 'ficha.html',      rotulo: 'Ficha Técnica' }
      ]
    },
    paciente: {
      sub: 'Seu acompanhamento nutricional',
      inicio: 'area-paciente.html',
      abas: [
        { id: 'inicio', href: 'area-paciente.html', rotulo: 'Início' }
      ]
    }
  };

  /**
   * Desenha o cabeçalho interno dentro de <header id="app-shell">.
   * @param {string} ativo id da aba atual ('painel', 'pacientes', 'inicio'…)
   */
  async function montarCabecalho(ativo) {
    const alvo = document.querySelector('#app-shell');
    if (!alvo) return;

    const usuario = await Auth.usuarioAtual();
    const nav = NAVEGACAO[usuario && usuario.papel] || NAVEGACAO.nutricionista;

    // Só quem tem papel_admin vê a aba — a página em si também se
    // protege sozinha (ver admin.html), esta linha é só não oferecer um
    // link que a maioria das contas não pode usar.
    const abasComAdmin = (usuario && usuario.perfil && usuario.perfil.papel_admin)
      ? [...nav.abas, { id: 'admin', href: 'admin.html', rotulo: 'Aprovações' }]
      : nav.abas;

    const nomeUsuario = escapar(usuario ? usuario.nome : '');
    const ehNutricionista = !!(usuario && usuario.papel === 'nutricionista');
    const fotoUrl = (usuario && usuario.perfil && usuario.perfil.foto_url) || '';
    const plano = (usuario && usuario.perfil && usuario.perfil.plano) || 'gratuito';
    const planoRotulo = plano === 'pro' ? 'Pro' : 'Gratuito';

    /* Uma aba só não é navegação, é enfeite: o paciente fica com o
       cabeçalho simples de sempre até a área dele ter mais de uma seção
       — trocar para sidebar aqui só empurraria o conteúdo sem ganhar
       nada, já que não há entre o que navegar. */
    if (abasComAdmin.length <= 1) {
      document.body.classList.remove('tem-sidebar');
      alvo.className = 'app-header';
      alvo.innerHTML = `
        <div class="wrap header-inner">
          <a class="brand brand-link" href="${nav.inicio}">
            ${MARCA_SVG}
            <div>
              <h1>NutriFicha</h1>
              <p class="brand-sub">${escapar(nav.sub)}</p>
            </div>
          </a>
          <div class="header-acoes">
            <span class="usuario-nome">${nomeUsuario}</span>
            <button id="btn-sair" class="btn btn-ghost btn-sm" type="button">Sair</button>
          </div>
        </div>`;
      alvo.querySelector('#btn-sair').addEventListener('click', sair);
      return;
    }

    document.body.classList.add('tem-sidebar');
    alvo.className = 'app-sidebar';
    alvo.innerHTML = `
      <div class="sidebar-barra-mobile naoimprimir">
        <a class="brand brand-link brand-mini" href="${nav.inicio}">
          ${MARCA_SVG}<span>NutriFicha</span>
        </a>
        <button id="btn-abrir-menu" class="btn-hamburguer" type="button"
                aria-label="Abrir menu" aria-expanded="false" aria-controls="sidebar-painel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
      </div>

      <div class="sidebar-fundo naoimprimir" id="sidebar-fundo"></div>

      <div class="sidebar-painel" id="sidebar-painel">
        <div class="sidebar-topo">
          <a class="brand brand-link" href="${nav.inicio}">
            ${MARCA_SVG}
            <div>
              <h1>NutriFicha</h1>
              <p class="brand-sub">${escapar(nav.sub)}</p>
            </div>
          </a>
          <button id="btn-fechar-menu" class="btn-fechar-menu naoimprimir" type="button" aria-label="Fechar menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        ${ehNutricionista ? `
          <div class="sidebar-perfil">
            <button class="avatar avatar-grande avatar-perfil" id="btn-avatar" type="button" aria-label="Editar foto de perfil">
              ${fotoUrl
                ? `<img src="${escapar(fotoUrl)}" alt="">`
                : `<span aria-hidden="true">${iniciais(usuario.nome)}</span>`}
            </button>
            <input type="file" accept="image/*" id="input-foto" hidden>
            <div class="sidebar-perfil-info">
              <strong class="sidebar-perfil-nome">${nomeUsuario}</strong>
              <a class="badge-plano" href="perfil.html">${planoRotulo}</a>
            </div>
          </div>` : ''}

        <nav class="sidebar-nav" aria-label="Seções do sistema">
          ${abasComAdmin.map((a) => `
            <a class="item-sidebar" href="${a.href}" ${ativo === a.id ? 'aria-current="page"' : ''}>
              ${icone(a.id)}<span>${a.rotulo}</span>
            </a>
          `).join('')}
        </nav>

        <div class="sidebar-rodape">
          <button id="btn-sair" class="btn btn-ghost btn-sm sidebar-sair" type="button">Sair</button>
        </div>
      </div>`;

    alvo.querySelector('#btn-sair').addEventListener('click', sair);

    if (ehNutricionista) {
      const btnAvatar = alvo.querySelector('#btn-avatar');
      const inputFoto = alvo.querySelector('#input-foto');
      btnAvatar.addEventListener('click', () => inputFoto.click());
      inputFoto.addEventListener('change', async () => {
        const arquivo = inputFoto.files[0];
        // Limpa já aqui: sem isso, escolher o mesmo arquivo de novo (pra
        // tentar de novo depois de um erro, por exemplo) não dispara o
        // evento 'change' uma segunda vez.
        inputFoto.value = '';
        if (!arquivo) return;

        btnAvatar.disabled = true;
        const resultado = await PerfilStore.enviarFoto(arquivo);
        btnAvatar.disabled = false;

        if (!resultado.ok) { toast(resultado.erro); return; }
        btnAvatar.innerHTML = `<img src="${escapar(resultado.fotoUrl)}" alt="">`;
        toast('Foto atualizada.');
      });
    }

    const btnAbrir = alvo.querySelector('#btn-abrir-menu');
    const btnFechar = alvo.querySelector('#btn-fechar-menu');
    const fundo = alvo.querySelector('#sidebar-fundo');

    function abrirMenu() {
      alvo.classList.add('menu-aberto');
      btnAbrir.setAttribute('aria-expanded', 'true');
    }
    function fecharMenu() {
      alvo.classList.remove('menu-aberto');
      btnAbrir.setAttribute('aria-expanded', 'false');
    }

    btnAbrir.addEventListener('click', abrirMenu);
    btnFechar.addEventListener('click', fecharMenu);
    fundo.addEventListener('click', fecharMenu);
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') fecharMenu();
    });
    // Ir para outra seção fecha o menu sozinho — sem isso, o painel
    // continuaria aberto por cima da página seguinte já carregada.
    alvo.querySelectorAll('.item-sidebar').forEach((a) => a.addEventListener('click', fecharMenu));
  }

  async function sair() {
    await Auth.logout();
    location.href = 'index.html';
  }

  /* Os dados agora ficam em banco, com Row Level Security separando por
     conta. O aviso mudou de conteúdo, mas continua existindo: o teste
     que falta — duas contas de paciente, uma não vendo a outra — só é
     possível quando a área do paciente estiver pronta. Enquanto isso
     não for verificado, dado real de saúde não entra aqui. */
  function avisoArmazenamento() {
    return `
      <p class="aviso-dados">
        <strong>Ainda em testes:</strong> os dados já ficam num banco de dados,
        separados por conta, e não mais só neste navegador. A separação entre
        contas de paciente ainda está sendo verificada — até lá, use dados
        fictícios em vez de informação real de paciente.
      </p>`;
  }

  return {
    escapar, formatarData, formatarDataHora, calcularIdade, iniciais,
    toast, montarCabecalho, avisoArmazenamento, MARCA_SVG
  };
})();
