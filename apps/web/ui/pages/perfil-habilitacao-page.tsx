/** @figma nodeId=88:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 88:49 (Dark) */
import { useState } from 'react';
import { Button, Badge } from '@/ui/components';
import { Textarea } from '@/ui/components/Textarea.js';
import { usePerfilHabilitacao } from '@/ui/hooks/use-perfil-habilitacao.js';
import type { PerfilHabilitacaoDTO } from '@/application/ports.js';

type PerfilTab = 'juridica' | 'fiscal' | 'tecnica' | 'economica';

interface TabConfig {
  key: PerfilTab;
  label: string;
  labelCampo: string;
  campo: keyof PerfilHabilitacaoDTO;
  placeholder: string;
  documentos: string[];
  nota: string;
  checklist: string[];
}

const TABS: TabConfig[] = [
  {
    key: 'juridica',
    label: 'Jurídica',
    labelCampo: 'Habilitação Jurídica',
    campo: 'habJuridica',
    placeholder:
      'Ex.: Sociedade Limitada; contrato social com objeto de TI/software; sem falência. Uma informação por linha.',
    documentos: ['Contrato Social / Ato constitutivo', 'Procuração (se aplicável)', 'Certidão Negativa de Falência e Concordata'],
    nota: 'Documentos exigíveis conforme arts. 66–68 da Lei 14.133/2021. O CNAE do contrato social precisa casar com o objeto do edital.',
    checklist: [
      'Tipo societário e composição',
      'Objeto social compatível com o que você disputa',
      'Situação cadastral ativa (sem falência/RJ)',
    ],
  },
  {
    key: 'fiscal',
    label: 'Fiscal / Trabalhista',
    labelCampo: 'Habilitação Fiscal e Trabalhista',
    campo: 'habFiscal',
    placeholder:
      'Ex.: CND Federal regular; CRF FGTS regular; CNDT regular; certidões estadual/municipal. Uma por linha.',
    documentos: ['CND Federal (RFB / PGFN)', 'CRF (FGTS)', 'Certidão Negativa de Débitos Trabalhistas', 'Certidões Estadual e Municipal'],
    nota: 'Regularidade fiscal exigida pelo art. 68 da Lei 14.133/2021. Pendência em qualquer esfera costuma inabilitar.',
    checklist: [
      'CND Federal (RFB/PGFN)',
      'CRF do FGTS',
      'CNDT (Justiça do Trabalho)',
      'Certidões estadual e municipal',
    ],
  },
  {
    key: 'tecnica',
    label: 'Técnica',
    labelCampo: 'Qualificação Técnica',
    campo: 'habTecnica',
    placeholder:
      'Ex.: CNAE 6201-5/01; Porte EPP; atestados de desenvolvimento/sustação de software; atuação remota com suporte on-site sob demanda.',
    documentos: ['Atestado de Capacidade Técnica', 'Registro / Certidão de entidade profissional (se aplicável)', 'Declaração de Capacidade Técnica Operacional'],
    nota: 'Qualificação técnica (art. 67). Atestados com complexidade e volume semelhantes ao edital costumam ser o maior filtro.',
    checklist: [
      'CNAEs compatíveis com o objeto',
      'Porte (ME / EPP / Demais) — tratamento favorecido',
      'Atestados de capacidade técnica',
      'Capacidade operacional e logística (UF / on-site)',
    ],
  },
  {
    key: 'economica',
    label: 'Econômico-Financeira',
    labelCampo: 'Qualificação Econômico-Financeira',
    campo: 'habEconomica',
    placeholder:
      'Ex.: Simples Nacional; capital social R$ 100.000; balanço do último exercício; índices de liquidez ok.',
    documentos: ['Balanço Patrimonial (último exercício)', 'Demonstração de Resultado (DRE)', 'Certidão Negativa de Protestos'],
    nota: 'Art. 69 — balanço, liquidez e capital mínimo (muitas vezes até ~10% do valor estimado). Regime tributário afeta competitividade de preço.',
    checklist: [
      'Regime tributário (Simples / Presumido / Real)',
      'Capital social / patrimônio líquido',
      'Balanço e índices de liquidez',
      'Capacidade de absorver cronograma sem risco de multa',
    ],
  },
];

export function PerfilHabilitacaoPage() {
  const [tab, setTab] = useState<PerfilTab>('juridica');
  const { campos, carregarEstado, salvarEstado, setCampos, salvar } = usePerfilHabilitacao();

  const tabConfig = TABS.find((t) => t.key === tab)!;
  const salvando = salvarEstado.status === 'salvando';

  function handleChange(value: string) {
    setCampos({ ...campos, [tabConfig.campo]: value });
  }

  function inserirChecklist() {
    const linhas = tabConfig.checklist.map((c) => `• ${c}: `);
    const atual = campos[tabConfig.campo]?.trim() ?? '';
    const bloco = linhas.join('\n');
    handleChange(atual ? `${atual}\n${bloco}` : bloco);
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={{ margin: '0 0 var(--radar-space-2)', fontSize: '1.25rem', fontWeight: 600 }}>
        Perfil de Habilitação
      </h1>
      <p style={{ margin: '0 0 var(--radar-space-4)', fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-muted)' }}>
        Viabilidade legal da empresa (Lei 14.133). Usado na Triagem e no chat de Oportunidades.
        Alertas do Dashboard vêm dos critérios em Configurar Radar (CNAE/UF/palavras-chave).
      </p>

      <div
        style={{
          marginBottom: 'var(--radar-space-6)',
          padding: '12px 16px',
          borderRadius: 'var(--radar-radius-md)',
          background: 'var(--radar-color-bg-canvas)',
          border: '1px solid var(--radar-color-border-default)',
          fontSize: 'var(--radar-font-size-sm)',
          color: 'var(--radar-color-text-default)',
          lineHeight: 1.45,
        }}
      >
        Preencha as quatro frentes: jurídica, fiscal, técnica e econômico-financeira.
        Na técnica informe CNAE e porte (ME/EPP); na econômica, regime e capital.
      </div>

      <div
        style={{
          display: 'flex',
          gap: 'var(--radar-space-2)',
          borderBottom: '1px solid var(--radar-color-border-default)',
          marginBottom: 'var(--radar-space-6)',
        }}
      >
        {TABS.map(({ key, label }) => {
          const ativa = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                border: 'none',
                cursor: 'pointer',
                padding: '6px 14px',
                borderRadius: 'var(--radar-radius-sm) var(--radar-radius-sm) 0 0',
                background: ativa ? 'var(--radar-color-action-primary)' : 'transparent',
                color: ativa ? 'var(--radar-color-text-onPrimary)' : 'var(--radar-color-text-muted)',
                fontSize: 'var(--radar-font-size-sm)',
                fontFamily: 'var(--radar-font-sans)',
                fontWeight: ativa ? 600 : 400,
                marginBottom: -1,
                borderBottom: ativa ? '2px solid var(--radar-color-action-primary)' : '2px solid transparent',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {carregarEstado.status === 'loading' && (
        <div style={{ color: 'var(--radar-color-text-muted)', fontSize: 'var(--radar-font-size-sm)', padding: 'var(--radar-space-4) 0' }}>
          Carregando perfil...
        </div>
      )}

      {carregarEstado.status === 'erro' && (
        <div
          style={{
            padding: 'var(--radar-space-3) var(--radar-space-4)',
            borderRadius: 'var(--radar-radius-sm)',
            background: 'var(--radar-color-feedback-erro-bg)',
            color: 'var(--radar-color-feedback-erro-fg)',
            fontSize: 'var(--radar-font-size-sm)',
            marginBottom: 'var(--radar-space-4)',
          }}
        >
          {carregarEstado.mensagem}
        </div>
      )}

      {carregarEstado.status === 'carregado' && (
        <>
          <section style={{ marginBottom: 'var(--radar-space-6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--radar-space-4)' }}>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{tabConfig.label}</h2>
              <Button variant="secondary" size="sm" onClick={inserirChecklist} disabled={salvando}>
                Inserir checklist
              </Button>
            </div>

            <div style={{ marginBottom: 'var(--radar-space-2)', fontSize: 'var(--radar-font-size-sm)', fontWeight: 500 }}>
              {tabConfig.labelCampo}
            </div>

            <Textarea
              value={campos[tabConfig.campo]}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={tabConfig.placeholder}
              disabled={salvando}
            />

            <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-muted)' }}>
              {tabConfig.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <div
              style={{
                marginTop: 'var(--radar-space-6)',
                marginBottom: 'var(--radar-space-3)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--radar-space-3)',
                color: 'var(--radar-color-text-muted)',
                fontSize: 'var(--radar-font-size-sm)',
              }}
            >
              <span style={{ flex: 1, height: 1, background: 'var(--radar-color-border-default)' }} />
              <span>Documentos a anexar (Pós-MVP)</span>
              <span style={{ flex: 1, height: 1, background: 'var(--radar-color-border-default)' }} />
            </div>

            {tabConfig.documentos.map((doc) => (
              <div
                key={doc}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--radar-space-3)',
                  padding: 'var(--radar-space-2) 0',
                  borderBottom: '1px solid var(--radar-color-bg-subtle)',
                  opacity: 0.6,
                }}
              >
                <span style={{ flex: 1, fontSize: 'var(--radar-font-size-sm)' }}>{doc}</span>
                <Badge type="neutro" size="sm">Pós-MVP</Badge>
              </div>
            ))}

            <p style={{ marginTop: 'var(--radar-space-3)', fontSize: '0.75rem', color: 'var(--radar-color-text-muted)' }}>
              {tabConfig.nota}
            </p>
          </section>

          {salvarEstado.status === 'erro' && (
            <div
              style={{
                padding: 'var(--radar-space-3) var(--radar-space-4)',
                borderRadius: 'var(--radar-radius-sm)',
                background: 'var(--radar-color-feedback-erro-bg)',
                color: 'var(--radar-color-feedback-erro-fg)',
                fontSize: 'var(--radar-font-size-sm)',
                marginBottom: 'var(--radar-space-4)',
              }}
            >
              {salvarEstado.mensagem}
            </div>
          )}
          {salvarEstado.status === 'salvo' && (
            <div
              style={{
                padding: 'var(--radar-space-3) var(--radar-space-4)',
                borderRadius: 'var(--radar-radius-sm)',
                background: 'var(--radar-color-feedback-sucesso-bg)',
                color: 'var(--radar-color-feedback-sucesso-fg)',
                fontSize: 'var(--radar-font-size-sm)',
                marginBottom: 'var(--radar-space-4)',
              }}
            >
              Perfil salvo. O chat e a Triagem usarão estas informações.
            </div>
          )}

          <Button variant="primary" onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar perfil'}
          </Button>
        </>
      )}
    </div>
  );
}
