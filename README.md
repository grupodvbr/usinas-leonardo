# Solar Central v3 — GitHub + Vercel

Pacote simples e direto para Vercel: um único `index.html` contém todo o front (HTML, CSS e JavaScript) e a pasta `api/` contém as Vercel Functions.

## Estrutura

- `index.html` — front completo, tema claro.
- `api/health.mjs` — diagnóstico.
- `api/login.mjs` — login do painel.
- `api/me.mjs` — sessão.
- `api/logout.mjs` — logout.
- `api/credentials.mjs` — lista acessos mascarados.
- `api/reveal.mjs` — revela um acesso após autenticação.
- `api/status.mjs` — verifica os portais oficiais.
- `lib/core.mjs` — funções compartilhadas.
- `assets/` — logos das plataformas.
- `vercel.json` — configuração mínima, sem rewrites que possam derrubar a página inicial.

## Vercel

1. Suba o conteúdo deste ZIP na RAIZ do repositório GitHub.
2. Na Vercel, Framework Preset: `Other`.
3. Root Directory: `./` quando `index.html` estiver na raiz do repositório.
4. Não configure Build Command, Output Directory ou Start Command.
5. Cadastre as variáveis do arquivo `VERCEL-ENV.txt` em Settings → Environment Variables.
6. Faça Redeploy.

## Testes rápidos depois do deploy

Abra:
- `/` — deve abrir o painel.
- `/api/health` — deve retornar JSON, nunca a página de erro da função.

## Segurança

Não coloque senhas no GitHub. Coloque somente em Environment Variables da Vercel.
