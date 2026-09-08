# Solar Central V4 — dados dentro do painel

Projeto estático + Vercel Functions. O `index.html` é o front completo e as APIs ficam em `/api`.

## O que esta versão faz

- Login principal protegido por cookie HttpOnly.
- Lê múltiplos acessos por plataforma a partir das Environment Variables da Vercel.
- Exibe dados das usinas dentro do Solar Central, sem precisar abrir o portal para monitorar.
- Atualiza automaticamente a cada 5 minutos.
- ShinePhone/Growatt: integração por sessão do ShineServer com USER/PASSWORD.
- iSolarCloud: OpenAPI V1 com USER/PASSWORD + APP_KEY + SECRET_KEY.
- elekeeper: Elekeeper Open Platform com APP_ID + APP_SECRET e recursos autorizados.
- SOLARMAN: OpenAPI com USER/PASSWORD + APP_ID + APP_SECRET.

## Deploy

1. Coloque o conteúdo desta pasta na raiz do repositório GitHub.
2. Na Vercel: Framework = Other, Root Directory = `./`.
3. Cadastre as Environment Variables conforme `VERCEL-ENV.txt`.
4. Faça Redeploy.
5. Teste `/api/health`.

## Observação importante

As APIs oficiais de iSolarCloud, elekeeper e SOLARMAN exigem credenciais de desenvolvedor além do login normal. Apenas USER/PASSWORD não autoriza terceiros a consultar os dados nesses três serviços. O ShinePhone é a exceção nesta versão: ele usa a sessão web do ShineServer; se Growatt exigir CAPTCHA ou mudar o portal, a integração pode pedir adaptação.
