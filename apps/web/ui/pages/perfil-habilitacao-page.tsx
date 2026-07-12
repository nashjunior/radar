/** @figma nodeId=88:2 fileKey=SAbjXOQO4gFAH4syq7VdQf (Light) / 88:49 (Dark) */
import { useState } from 'react';
import { Button, Badge } from '@/ui/components';
import { Textarea } from '@/ui/components/Textarea.js';
import { usePerfilHabilitacao } from '@/ui/hooks/use-perfil-habilitacao.js';
import { useSessao } from '@/ui/hooks/use-sessao';
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
}

const TABS: TabConfig[] = [
  {
    key: 'juridica',
    label: 'Jurídica',
    labelCampo: 'Habilitação Jurídica',
    campo: 'habJuridica',
    placeholder: 'Descreva a situação jurídica da empresa: tipo societário, composição, regularidade e informações relevantes para licitações.',
    documentos: ['Contrato Social / Ato constitutivo', 'Procuração (se aplicável)', 'Certidão Negativa de Falência e Concordata'],
    nota: 'Documentos exigíveis conforme art. 66-68 da Lei 14.133/2021.',
  },
  {
    key: 'fiscal',
    label: 'Fiscal / Trabalhista',
    labelCampo: 'Habilitação Fiscal e Trabalhista',
    campo: 'habFiscal',
    placeholder: 'Descreva a situação fiscal e trabalhista: regularidade tributária federal, estadual, municipal, FGTS e INSS.',
    documentos: ['CND Federal (RFB / PGFN)', 'CRF (FGTS)', 'Certidão Negativa de Débitos Trabalhistas', 'Certidões Estadual e Municipal'],
    nota: 'Regularidade fiscal exigida pelo art. 68 da Lei 14.133/2021.',
  },
  {
    key: 'tecnica',
    label: 'Técnica',
    labelCampo: 'Qualificação Técnica',
    campo: 'habTecnica',
    placeholder: 'Descreva a capacidade técnica da empresa: área de atuação, CNAE, experiências anteriores relevantes e certificações.',
    documentos: ['Atestado de Capacidade Técnica', 'Registro / Certidão de entidade profissional (se aplicável)', 'Declaração de Capacidade Técnica Operacional'],
    nota: 'Qualificação técnica prevista no art. 67 da Lei 14.133/2021.',
  },
  {
    key: 'economica',
    label: 'Econômico-Financeira',
    labelCampo: 'Qualificação Econômico-Financeira',
    campo: 'habEconomica',
    placeholder: 'Descreva a situação econômico-financeira: capital social, índices de liquidez (ILC, ILG, SG) e patrimônio líquido.',
    documentos: ['Balanço Patrimonial (último exercício)', 'Demonstração de Resultado (DRE)', 'Certidão Negativa de Protestos'],
    nota: 'Qualificação econômico-financeira prevista no art. 69 da Lei 14.133/2021.',
  },
];

export function PerfilHabilitacaoPage() {
  const [tab, setTab] = useState<PerfilTab>('juridica');
  const { campos, carregarEstado, salvarEstado, setCampos, salvar } = usePerfilHabilitacao();
  const { pode } = useSessao();
  const podeEditarPerfil = pode('PERFIL_HABILITACAO', 'editar');

  const tabConfig = TABS.find((t) => t.key === tab)!;
  const salvando = salvarEstado.status === 'salvando';

  function handleChange(value: string) {
    setCampos({ ...campos, [tabConfig.campo]: value });
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={{ margin: '0 0 var(--radar-space-2)', fontSize: '1.25rem', fontWeight: 600 }}>
        Perfil de Habilitação
      </h1>
      <p style={{ margin: '0 0 var(--radar-space-6)', fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-muted)' }}>
        Preencha as informações da empresa por seção. Elas são usadas pela Triagem para avaliar aderência ao edital.
      </p>

      {/* Abas */}
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

      {/* Conteúdo da aba */}
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
            <h2 style={{ margin: '0 0 var(--radar-space-4)', fontSize: '1rem', fontWeight: 600 }}>
              {tabConfig.label}
            </h2>

            <div style={{ marginBottom: 'var(--radar-space-2)', fontSize: 'var(--radar-font-size-sm)', fontWeight: 500, color: 'var(--radar-color-text-default)' }}>
              {tabConfig.labelCampo}
            </div>

            <Textarea
              value={campos[tabConfig.campo]}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={tabConfig.placeholder}
              disabled={salvando || !podeEditarPerfil}
            />

            {/* Separador Pós-MVP */}
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
              <span>Documentos a enviar (Pós-MVP) ↓</span>
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
                <span style={{ flex: 1, fontSize: 'var(--radar-font-size-sm)', color: 'var(--radar-color-text-default)' }}>
                  {doc}
                </span>
                <Badge type="neutro" size="sm">Pós-MVP</Badge>
              </div>
            ))}

            <p style={{ marginTop: 'var(--radar-space-3)', fontSize: '0.75rem', color: 'var(--radar-color-text-muted)' }}>
              {tabConfig.nota}
            </p>
          </section>

          {/* Feedback de salvar */}
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
              Perfil salvo com sucesso.
            </div>
          )}

          {podeEditarPerfil && (
            <Button variant="primary" onClick={() => void salvar()} disabled={salvando}>
              {salvando ? 'Salvando...' : 'Salvar documentos'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
