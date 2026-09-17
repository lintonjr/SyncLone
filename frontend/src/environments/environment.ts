/**
 * Configuração da aplicação no navegador.
 *
 * `apiUrl` é **relativo de propósito**. Ele já foi `http://localhost:3001/api`,
 * e como o Angular compila este arquivo dentro do bundle, esse endereço viajava
 * para produção: o navegador de quem abrisse o site tentaria falar com a porta
 * 3001 da própria máquina. Funcionava só na máquina de quem desenvolve, que é a
 * pior categoria de defeito — o que passa em todo teste e quebra no primeiro
 * usuário.
 *
 * Relativo, SPA e API ficam sempre na mesma origem, e quem resolve o roteamento
 * é a camada de cada ambiente: o proxy do `ng serve` (proxy.conf.json) em
 * desenvolvimento, o nginx no Docker local, o CloudFront em produção. Nenhum
 * deles precisa de um build diferente — a mesma imagem serve os três, e não há
 * `fileReplacements` a manter.
 *
 * Corolário: quem monta URL de imagem faz `apiUrl.replace('/api', '')`, que aqui
 * dá string vazia — e `/uploads/x.png` também vira caminho da mesma origem.
 */
export const environment = {
  production: false,
  apiUrl: '/api',
};
