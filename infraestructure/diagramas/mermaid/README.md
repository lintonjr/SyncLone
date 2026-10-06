# Fontes mermaid dos diagramas do HLD

Os diagramas de `frontend/public/docs/index.html` são **SVG embutido**, não imagens: a
página não carrega script nenhum, e por isso o desenho precisa já vir renderizado. Estas
são as fontes de onde o SVG saiu.

| Arquivo | Onde aparece no HLD | Ids no HTML |
|---|---|---|
| [`avaliacao-estados.mmd`](avaliacao-estados.mmd) | 7.4 — a máquina de estados da OS | `svg-d7-neutral` · `svg-d7-dark` |
| [`avaliacao-er.mmd`](avaliacao-er.mmd) | 08 — o domínio de avaliação | `svg-d6-neutral` · `svg-d6-dark` |

Os diagramas `d1` a `d5` (arquitetura, fluxos e o ER do núcleo de torneio) foram
renderizados antes deste diretório existir e **não têm fonte guardada** — para alterá-los,
é preciso reescrever o mermaid a partir do SVG.

## Como renderizar

Cada diagrama entra **duas vezes** na página, um para cada tema, e o CSS alterna entre
`.diagrama-claro` e `.diagrama-escuro`.

```bash
npm install @mermaid-js/mermaid-cli          # num diretório temporário; não é dependência do projeto
echo '{ "executablePath": "/usr/bin/google-chrome", "args": ["--no-sandbox"] }' > puppeteer.json
echo '{ "fontFamily": "IBM Plex Sans,system-ui,sans-serif" }' > config.json

for t in neutral dark; do
  mmdc -i avaliacao-estados.mmd -o estados-$t.svg -t $t -b transparent -p puppeteer.json -c config.json
done
```

Depois, no SVG gerado, **troque `my-svg` pelo id final** (`svg-d7-neutral`, `svg-d7-dark`).
O mermaid usa esse mesmo prefixo em todos os ids internos e nos seletores do `<style>`; sem
a troca, os SVG da página colidem entre si e um herda o estilo do outro.

## Convenções que o HLD espera

- `-b transparent`: o fundo é da `.diagrama`, não do SVG
- Tema `neutral` para o claro, `dark` para o escuro
- Fonte **IBM Plex Sans**, a mesma da página
- Largura: o SVG escala com `max-width: 100%`, então um diagrama muito largo fica ilegível
  no celular. A máquina de estados foi desenhada em `direction TB` justamente por isso —
  em `LR` ela saía com 2431px de largura e o texto sumia ao escalar.
