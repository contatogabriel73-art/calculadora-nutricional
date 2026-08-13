/* ============================================================
   area-paciente.js — a tela do paciente

   Só leitura. Nada aqui grava dado clínico — quem registra é o
   nutricionista; o paciente acompanha.

   Sem vínculo, a RLS não deixa a conta enxergar nenhuma linha de
   `pacientes`, então nem o próprio nome aparece até o código ser usado
   (ver vinculo-storage.js e a função `resgatar_convite` no banco).
   ============================================================ */

'use strict';

(async () => {

  if (!(await Auth.exigirLogin('paciente'))) return;
  await Shell.montarCabecalho('inicio');

  const $ = (s) => document.querySelector(s);
  const esc = Shell.escapar;
  const n1 = (v) => (v == null || !isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

  const usuario = await Auth.usuarioAtual();
  const primeiro = String(usuario.nome || '').trim().split(/\s+/)[0] || '';
  $('#saudacao').textContent = primeiro ? `Olá, ${primeiro}` : 'Olá';

  const paciente = await VinculoStore.fichaVinculada();

  /* ───────────── Sem vínculo: pede o código ───────────── */

  if (!paciente) {
    $('#bloco-sem-vinculo').hidden = false;

    $('#form-codigo').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const erro = $('#erro-codigo');
      erro.hidden = true;

      const botao = ev.target.querySelector('button[type="submit"]');
      botao.disabled = true;

      const r = await VinculoStore.resgatarConvite($('#codigo').value);

      botao.disabled = false;

      if (!r.ok) {
        erro.textContent = r.erro;
        erro.hidden = false;
        return;
      }

      // O vínculo já está gravado no banco; recarregar a página monta a
      // área de verdade com os dados agora visíveis, em vez de tentar
      // remontar tudo aqui.
      location.reload();
    });

    return;
  }

  /* ───────────── Vinculado: monta a área ───────────── */

  $('#area-vinculada').hidden = false;

  const perfilNutri = await Banco.tabela('perfis')
    .select('nome').eq('id', paciente.nutricionista_id).maybeSingle();
  $('#nome-nutricionista').textContent =
    (perfilNutri.data && perfilNutri.data.nome) || 'seu nutricionista';

  /* ───────────── Próxima consulta ───────────── */

  async function desenharProximaConsulta() {
    const agora = new Date();
    const hojeIso = agora.getFullYear() + '-' +
      String(agora.getMonth() + 1).padStart(2, '0') + '-' +
      String(agora.getDate()).padStart(2, '0');

    const proxima = await AgendaStore.proximaDoPaciente(paciente.id, hojeIso);
    const alvo = $('#proxima-consulta');

    if (!proxima) {
      alvo.innerHTML = '<p class="vazio-suave">Nenhuma consulta agendada no momento.</p>';
      return;
    }

    alvo.innerHTML = `
      <div class="proxima-consulta-item">
        <strong>${esc(Shell.formatarData(proxima.data))}</strong> às ${esc(proxima.hora)}
        <span class="tag tag-${AgendaStore.nivelStatus(proxima.status)}">${esc(AgendaStore.rotuloStatus(proxima.status))}</span>
        <p class="dica">${esc(proxima.tipo)}</p>
      </div>`;
  }

  /* ───────────── Evolução ───────────── */

  async function desenharEvolucao() {
    const avaliacoes = await ProntuarioStore.listarAvaliacoesCronologicas(paciente.id);
    const metas = await PlanosStore.obterMetas(paciente.id);

    if (!avaliacoes.length) {
      $('#sem-avaliacoes').hidden = false;
      return;
    }

    const ultima = avaliacoes[avaliacoes.length - 1];
    const a = Antropometria.analisar(ultima, paciente);
    const cls = a.classificacaoImc;
    const pesoMeta = metas && metas.pesoMeta ? parseFloat(String(metas.pesoMeta).replace(',', '.')) : null;

    $('#resumo-evolucao').innerHTML = `
      <p class="dica">Última medição em ${esc(Shell.formatarData(ultima.data))}</p>
      <div class="grade-metricas">
        <div class="metrica">
          <span class="metrica-rotulo">Peso</span>
          <span class="metrica-valor">${n1(Antropometria.num(ultima.peso))} <em>kg</em></span>
          ${pesoMeta ? `<span class="metrica-extra">meta: ${n1(pesoMeta)} kg</span>` : ''}
        </div>
        <div class="metrica">
          <span class="metrica-rotulo">IMC</span>
          <span class="metrica-valor">${n1(a.imc)} <em>kg/m²</em></span>
          ${cls ? `<span class="tag tag-${cls.nivel}">${cls.texto}</span>` : ''}
        </div>
      </div>`;

    // Gráfico de linha exige pelo menos dois pontos — com um só, o
    // resumo acima já diz o que há para dizer.
    if (avaliacoes.length < 2 || !Graficos.disponivel()) {
      if (avaliacoes.length >= 2) {
        $('#graficos-evolucao').innerHTML =
          '<p class="grafico-indisponivel">' +
          'Não foi possível carregar os gráficos agora. Os números acima continuam corretos.</p>';
        $('#graficos-evolucao').hidden = false;
      }
      return;
    }

    const rotulos = avaliacoes.map((av) => Shell.formatarData(av.data));
    const pesos = avaliacoes.map((av) => Antropometria.num(av.peso));
    const imcs = avaliacoes.map((av) => Antropometria.analisar(av, paciente).imc);
    const cinturas = avaliacoes.map((av) =>
      Antropometria.num(av.circunferencias && av.circunferencias.cintura));

    $('#graficos-evolucao').hidden = false;

    const linhaBase = (rotulo, dados, cor) => ({
      label: rotulo,
      data: dados,
      borderColor: cor,
      backgroundColor: cor,
      spanGaps: true,
      tension: .25,
      pointRadius: 3
    });

    const datasetsPeso = [linhaBase('Peso (kg)', pesos, Graficos.CORES.verde)];
    if (pesoMeta) {
      datasetsPeso.push({
        label: 'Meta',
        data: rotulos.map(() => pesoMeta),
        borderColor: Graficos.CORES.ambar,
        borderDash: [6, 4],
        pointRadius: 0,
        borderWidth: 1.5
      });
    }
    Graficos.desenhar('grafico-peso', {
      type: 'line',
      data: { labels: rotulos, datasets: datasetsPeso },
      options: { plugins: { legend: { display: !!pesoMeta } } }
    });

    Graficos.desenhar('grafico-imc', {
      type: 'line',
      data: { labels: rotulos, datasets: [linhaBase('IMC (kg/m²)', imcs, Graficos.CORES.azul)] }
    });

    if (cinturas.some((v) => v != null)) {
      $('#caixa-cintura').hidden = false;
      Graficos.desenhar('grafico-cintura', {
        type: 'line',
        data: { labels: rotulos, datasets: [linhaBase('Cintura (cm)', cinturas, Graficos.CORES.roxo)] }
      });
    }
  }

  /* ───────────── Fichas e planos liberados ───────────── */
  /* A consulta já vem filtrada pela RLS: só chega aqui o que o
     nutricionista marcou como visivelPaciente. */

  async function desenharFichas() {
    const fichas = await FichasStore.listarFichasDoPaciente(paciente.id);
    if (!fichas.length) return;

    $('#bloco-fichas').hidden = false;
    $('#lista-fichas').innerHTML = fichas.map((f) => `
      <li>
        <strong>${esc(f.titulo)}</strong>
        <span class="dica">${esc(Shell.formatarData(f.atualizadoEm.slice(0, 10)))}</span>
      </li>`).join('');
  }

  async function desenharPlanos() {
    const planos = await PlanosStore.listarPlanos(paciente.id);
    if (!planos.length) return;

    $('#bloco-planos').hidden = false;
    $('#lista-planos').innerHTML = planos.map((p) => `
      <li>
        <strong>${esc(p.nome)}</strong>
        <span class="dica">${p.refeicoes.length} refeições · ${esc(Shell.formatarData(p.data))}</span>
      </li>`).join('');
  }

  await Promise.all([
    desenharProximaConsulta(),
    desenharEvolucao(),
    desenharFichas(),
    desenharPlanos()
  ]);
})();
