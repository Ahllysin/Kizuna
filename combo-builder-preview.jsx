import React, { useState, useMemo } from "react";
import { Zap, ArrowRight, Flame, Shield, Swords, RotateCcw } from "lucide-react";

// ---------------------------------------------------------------------------
// Dados de exemplo — na versão real isso vem do Supabase (tabelas
// `personagens`, `niveis_up`, `golpes`).
// ---------------------------------------------------------------------------

const EFEITOS = {
  empurrao: { label: "Empurrão", cor: "#E2572B" },
  derrubada: { label: "Derrubada", cor: "#3B82F6" },
  elevacao_alta: { label: "Elevação Alta", cor: "#F2A93B" },
  elevacao_baixa: { label: "Elevação Baixa", cor: "#2DD4BF" },
};

const PERSONAGENS = [
  {
    id: "goku",
    nome: "Son Goku",
    niveisUp: ["Base", "Super Saiyajin", "Super Saiyajin Blue", "Ultra Instinto"],
    upAtual: 1,
    golpes: [
      { id: "g1", tipo: "ataque", nome: "Kamehameha Rápido", efeitoCausado: "empurrao" },
      { id: "g2", tipo: "ataque", nome: "Chute Giratório", efeitoCausado: "derrubada" },
      { id: "g3", tipo: "habilidade", nome: "Teleporte Instantâneo", efeitoCausado: "elevacao_alta" },
      { id: "g4", tipo: "suprema", nome: "Kamehameha 10x", efeitoCausado: "derrubada" },
      { id: "g5", tipo: "combinado", nome: "Combo Kaioken", efeitoRequisito: "derrubada", efeitoCausado: "elevacao_baixa" },
    ],
  },
  {
    id: "vegeta",
    nome: "Vegeta",
    niveisUp: ["Base", "Super Saiyajin", "Super Saiyajin Blue Evolution", "Ultra Ego"],
    upAtual: 2,
    golpes: [
      { id: "v1", tipo: "ataque", nome: "Big Bang Attack", efeitoCausado: "empurrao" },
      { id: "v2", tipo: "ataque", nome: "Rajada de Energia", efeitoCausado: "elevacao_alta" },
      { id: "v3", tipo: "habilidade", nome: "Investida Saiyajin", efeitoCausado: "derrubada" },
      { id: "v4", tipo: "suprema", nome: "Final Flash", efeitoCausado: "empurrao" },
      { id: "v5", tipo: "combinado", nome: "Combo Orgulho Saiyajin", efeitoRequisito: "elevacao_alta", efeitoCausado: "empurrao" },
    ],
  },
  {
    id: "gohan",
    nome: "Gohan",
    niveisUp: ["Base", "Super Saiyajin 2", "Beast"],
    upAtual: 1,
    golpes: [
      { id: "gh1", tipo: "ataque", nome: "Punho Místico", efeitoCausado: "empurrao" },
      { id: "gh2", tipo: "ataque", nome: "Chute Ki", efeitoCausado: "elevacao_alta" },
      { id: "gh3", tipo: "habilidade", nome: "Explosão de Raiva", efeitoCausado: "derrubada" },
      { id: "gh4", tipo: "suprema", nome: "Kamehameha do Pai", efeitoCausado: "elevacao_baixa" },
      { id: "gh5", tipo: "combinado", nome: "Combo Guerreiro Z", efeitoRequisito: "empurrao", efeitoCausado: "derrubada" },
    ],
  },
  {
    id: "piccolo",
    nome: "Piccolo",
    niveisUp: ["Base", "Potencial Desbloqueado", "Orange Piccolo"],
    upAtual: 2,
    golpes: [
      { id: "p1", tipo: "ataque", nome: "Canhão Especial", efeitoCausado: "empurrao" },
      { id: "p2", tipo: "ataque", nome: "Braço Elástico", efeitoCausado: "derrubada" },
      { id: "p3", tipo: "habilidade", nome: "Regeneração de Namekuseijin", efeitoCausado: "elevacao_baixa" },
      { id: "p4", tipo: "suprema", nome: "Makankosappo", efeitoCausado: "elevacao_alta" },
      { id: "p5", tipo: "combinado", nome: "Combo Guardião da Terra", efeitoRequisito: "derrubada", efeitoCausado: "empurrao" },
    ],
  },
  {
    id: "freeza",
    nome: "Freeza",
    niveisUp: ["1ª Forma", "Forma Final", "Golden Freeza", "Black Freeza"],
    upAtual: 2,
    golpes: [
      { id: "f1", tipo: "ataque", nome: "Disco da Morte", efeitoCausado: "derrubada" },
      { id: "f2", tipo: "ataque", nome: "Rajada Sobrenatural", efeitoCausado: "empurrao" },
      { id: "f3", tipo: "habilidade", nome: "Voo Supersônico", efeitoCausado: "elevacao_alta" },
      { id: "f4", tipo: "suprema", nome: "Esfera da Morte", efeitoCausado: "empurrao" },
      { id: "f5", tipo: "combinado", nome: "Combo Tirano Cósmico", efeitoRequisito: "elevacao_alta", efeitoCausado: "elevacao_baixa" },
    ],
  },
  {
    id: "trunks",
    nome: "Trunks do Futuro",
    niveisUp: ["Base", "Super Saiyajin", "Super Saiyajin Rage"],
    upAtual: 1,
    golpes: [
      { id: "t1", tipo: "ataque", nome: "Corte de Espada Ki", efeitoCausado: "elevacao_baixa" },
      { id: "t2", tipo: "ataque", nome: "Investida Voadora", efeitoCausado: "empurrao" },
      { id: "t3", tipo: "habilidade", nome: "Aura de Fúria", efeitoCausado: "derrubada" },
      { id: "t4", tipo: "suprema", nome: "Corte Espectral Buster", efeitoCausado: "derrubada" },
      { id: "t5", tipo: "combinado", nome: "Combo Lâmina do Futuro", efeitoRequisito: "elevacao_baixa", efeitoCausado: "empurrao" },
    ],
  },
];

const ICONE_TIPO = { ataque: Swords, habilidade: Zap, suprema: Flame, combinado: Shield };

// ---------------------------------------------------------------------------
// Lógica do combo automático: cada posição do time tenta CONTINUAR o combo
// (usa o ataque combinado se o efeito ativo bater com o requisito dele);
// se não bater, o personagem REINICIA com o primeiro golpe que gera efeito.
// ---------------------------------------------------------------------------

function simularCadeiaAutomatica(time) {
  let efeitoAtivo = null;
  const passos = [];

  for (const personagem of time) {
    const combinado = personagem.golpes.find((g) => g.tipo === "combinado");
    const golpeEntrada = personagem.golpes.find((g) => g.tipo !== "combinado");

    let golpeEscolhido;
    let continuou = false;

    if (combinado && efeitoAtivo && combinado.efeitoRequisito === efeitoAtivo) {
      golpeEscolhido = combinado;
      continuou = true;
    } else {
      golpeEscolhido = golpeEntrada;
    }

    passos.push({ personagem, golpe: golpeEscolhido, continuou });
    efeitoAtivo = golpeEscolhido.efeitoCausado;
  }

  return passos;
}

export default function DragonBallSitePreview() {
  const [ordemIds, setOrdemIds] = useState([
    "goku",
    "vegeta",
    "gohan",
    "piccolo",
    "freeza",
    "trunks",
  ]);

  const time = ordemIds.map((id) => PERSONAGENS.find((p) => p.id === id));
  const cadeia = useMemo(() => simularCadeiaAutomatica(time), [ordemIds]);

  const trocarSlot = (indice, novoId) => {
    const nova = [...ordemIds];
    nova[indice] = novoId;
    setOrdemIds(nova);
  };

  return (
    <div style={{ background: "#0E0F1A", color: "#EDEBE4", minHeight: "100%" }} className="w-full font-sans">
      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Header */}
        <header className="mb-10">
          <p style={{ color: "#F2A93B", letterSpacing: "0.04em" }} className="text-sm mb-1">
            Wiki &amp; Combos
          </p>
          <h1 style={{ fontWeight: 800, letterSpacing: "-0.02em" }} className="text-4xl mb-2">
            Simulador de combo automático
          </h1>
          <p style={{ color: "#9B98A8" }} className="text-base max-w-lg">
            Monte a ordem do time e o combo flui sozinho: cada personagem continua
            o efeito do anterior quando possível, ou reinicia o combo.
          </p>
        </header>

        {/* Montagem do time */}
        <div style={{ background: "#151626", border: "1px solid #2A2B3D" }} className="rounded-lg p-6 mb-8">
          <h3 className="text-sm mb-3" style={{ color: "#9B98A8" }}>
            Ordem do time (grid 2×3)
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {ordemIds.map((id, indice) => (
              <select
                key={indice}
                value={id}
                onChange={(e) => trocarSlot(indice, e.target.value)}
                style={{ background: "#1A1B2A", border: "1px solid #2A2B3D", color: "#EDEBE4" }}
                className="rounded-md px-3 py-2 text-sm"
              >
                {PERSONAGENS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {indice + 1}º — {p.nome}
                  </option>
                ))}
              </select>
            ))}
          </div>
        </div>

        {/* Resultado da simulação */}
        <div style={{ background: "#151626", border: "1px solid #2A2B3D" }} className="rounded-lg p-6">
          <h3 className="text-lg mb-4" style={{ fontWeight: 700 }}>
            Combo resultante
          </h3>

          <div className="flex flex-col gap-2">
            {cadeia.map((passo, i) => {
              const Icone = ICONE_TIPO[passo.golpe.tipo];
              const efeitoInfo = EFEITOS[passo.golpe.efeitoCausado];
              return (
                <div key={i}>
                  {i > 0 && (
                    <div className="flex items-center gap-2 pl-4 py-1">
                      <ArrowRight size={14} style={{ color: "#6E6C7C" }} />
                      <span
                        style={{ color: passo.continuou ? "#2DD4BF" : "#9B98A8" }}
                        className="text-xs"
                      >
                        {passo.continuou ? "combo continuado" : "combo reiniciado"}
                      </span>
                    </div>
                  )}
                  <div
                    style={{ background: "#1A1B2A", borderLeft: `3px solid ${efeitoInfo.cor}` }}
                    className="flex items-center gap-3 rounded-r-md px-4 py-3"
                  >
                    <Icone size={16} style={{ color: "#9B98A8", flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs" style={{ color: "#9B98A8" }}>
                        {passo.personagem.nome}
                      </p>
                      <p className="text-sm" style={{ fontWeight: 500 }}>
                        {passo.golpe.nome}
                      </p>
                    </div>
                    <span
                      style={{ background: efeitoInfo.cor + "22", color: efeitoInfo.cor }}
                      className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                    >
                      {efeitoInfo.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 mt-4 pt-4" style={{ borderTop: "1px solid #2A2B3D" }}>
            <RotateCcw size={12} style={{ color: "#6E6C7C" }} />
            <p style={{ color: "#6E6C7C" }} className="text-xs">
              Troque a ordem do time acima para ver o combo recalcular sozinho.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
