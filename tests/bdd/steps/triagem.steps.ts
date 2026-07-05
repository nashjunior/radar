import { Given, When, Then } from '@cucumber/cucumber';

// Triagem steps — PENDENTES aguardando RAD-30 (modules/triagem)
// Remover @pending nas features e implementar os steps quando RAD-30 estiver concluído.

Given(
  'um repositório de triagens em memória',
  function () {
    // pendente — modules/triagem não existe ainda (RAD-30)
    return 'pending';
  },
);

Given(
  'um gateway de LLM configurado com stub sintético',
  function () {
    return 'pending';
  },
);

Given(
  'um repositório de extração de edital em memória',
  function () {
    return 'pending';
  },
);

Given(
  'um edital com objeto {string} disponível para triagem',
  function (_objeto: string) {
    return 'pending';
  },
);

Given(
  'um perfil de habilitação do cliente {string} com CNAE {string}',
  function (_clienteId: string, _cnae: string) {
    return 'pending';
  },
);

Given(
  'o LLM retorna confiança {float} com recomendação {string}',
  function (_confianca: number, _recomendacao: string) {
    return 'pending';
  },
);

Given(
  'o LLM retorna confiança {float} abaixo do limiar configurado',
  function (_confianca: number) {
    return 'pending';
  },
);

Given(
  'uma triagem existente pertencente ao cliente {string}',
  function (_clienteId: string) {
    return 'pending';
  },
);

Given(
  'uma solicitação de triagem feita pelo cliente {string}',
  function (_clienteId: string) {
    return 'pending';
  },
);

Given(
  'um edital já triado uma vez para o perfil {string}',
  function (_perfilId: string) {
    return 'pending';
  },
);

When(
  'o sistema executa a triagem do edital para o perfil do cliente {string}',
  function (_clienteId: string) {
    return 'pending';
  },
);

When(
  'o sistema tenta retornar a triagem para o cliente {string}',
  function (_clienteId: string) {
    return 'pending';
  },
);

When(
  'uma segunda triagem é solicitada para o mesmo edital e mesmo perfil',
  function () {
    return 'pending';
  },
);

Then(
  'a triagem deve retornar recomendação {string}',
  function (_recomendacao: string) {
    return 'pending';
  },
);

Then(
  'a confiança deve ser igual a {float}',
  function (_confianca: number) {
    return 'pending';
  },
);

// o evento {string} deve ter sido publicado — step definido em matching.steps.ts

Then(
  'a triagem deve lançar ConfiancaInsuficienteError',
  function () {
    return 'pending';
  },
);

Then(
  'o resultado não deve conter recomendação definitiva',
  function () {
    return 'pending';
  },
);

Then(
  'a operação deve lançar AcessoNegadoError',
  function () {
    return 'pending';
  },
);

Then(
  'nenhuma informação do cliente {string} deve ser exposta',
  function (_clienteId: string) {
    return 'pending';
  },
);

Then(
  'o gateway LLM não deve ser chamado novamente para extração',
  function () {
    return 'pending';
  },
);

Then(
  'a triagem deve retornar em menos tempo que a primeira chamada',
  function () {
    return 'pending';
  },
);
