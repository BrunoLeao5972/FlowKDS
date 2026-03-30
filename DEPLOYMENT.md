# Deploy SaaS Hibrido no Railway (KDS)

Guia rapido para publicar o MVP SaaS em nuvem com multi-tenant e sync offline.

## 1. Arquitetura de deploy recomendada

1. MongoDB Atlas para persistencia principal.
2. Um servico backend no Railway, apontando para a pasta server.
3. Um servico frontend no Railway (ou Vercel/Netlify), apontando para a raiz do projeto.
4. Dominio separado:
   - app.seudominio.com para frontend.
   - api.seudominio.com para backend.

## 2. Preparar MongoDB Atlas

1. Crie o cluster no Atlas.
2. Em Database Access, crie usuario com senha forte.
3. Em Network Access, permita trafego do Railway.
4. Copie a connection string para o banco kds.

Exemplo de URI:

mongodb+srv://usuario:senha@cluster.mongodb.net/kds?retryWrites=true&w=majority&appName=KDS

## 3. Deploy do backend no Railway

1. No Railway, clique New Project.
2. Escolha Deploy from GitHub repo e selecione este repositorio.
3. Configure Root Directory como server.
4. Configure os comandos:
   - Build Command: npm install
   - Start Command: npm start
5. Defina PORT automaticamente pelo Railway (nao fixar 8081 na plataforma).

Variaveis de ambiente obrigatorias do backend:

1. MONGODB_URI
2. SAAS_JWT_SECRET
3. SAAS_ACCESS_TOKEN_TTL com valor sugerido 15m
4. SAAS_REFRESH_TOKEN_TTL_DAYS com valor sugerido 14
5. SAAS_SYNC_WORKER_INTERVAL_MS com valor sugerido 2000
6. CORS_ORIGIN com o dominio do frontend
7. AUTH_ENABLED=true
8. AUTH_TOKEN_SECRET para compatibilidade do modo legado
9. LEGACY_TENANT_ID=legacy

Opcional para compatibilidade legado:

1. AUTH_USERNAME
2. AUTH_PASSWORD

## 4. Deploy do frontend

Opcao A no Railway:

1. Novo servico no mesmo projeto.
2. Root Directory na raiz do repositorio.
3. Build Command: npm install e npm run build
4. Start Command: npm run preview -- --host 0.0.0.0 --port $PORT
5. Variavel VITE_API_BASE apontando para https://api.seudominio.com

Opcao B no Vercel/Netlify:

1. Deploy da raiz do projeto.
2. Variavel VITE_API_BASE apontando para https://api.seudominio.com

## 5. Dominio e DNS

1. No provedor DNS, crie CNAME para app.seudominio.com apontando para o host do frontend.
2. Crie CNAME para api.seudominio.com apontando para o host do backend.
3. Aguarde propagacao e emita SSL automatico na plataforma.

Para multi-tenant via subdominio de cliente:

1. Crie wildcard CNAME *.seudominio.com para o frontend.
2. Mantenha o backend resolvendo tenant por header x-tenant-id ou subdominio.

## 6. Smoke test apos deploy

1. Healthcheck: https://api.seudominio.com/healthz deve responder ok true.
2. Criar tenant de teste: POST /saas/tenants.
3. Login do tenant: POST /saas/auth/login com x-tenant-id.
4. Criar pedido: POST /saas/orders com bearer token.
5. Sincronizacao:
   - POST /saas/sync/push com evento de status.
   - GET /saas/sync/pull retornando eventos processados.
6. Realtime: abrir duas abas e validar atualizacao instantanea.

## 7. Pronto para vender com seguranca minima

Checklist de minimo recomendado:

1. Segredos fortes e rotacao periodica.
2. Backup diario no Atlas.
3. Logs centralizados e alerta de erro 5xx.
4. Rate limit ativo em login e refresh.
5. Teste de queda de internet com replay do outbox.

## 8. Evolucao para escala

1. Separar API, Socket e Worker em servicos dedicados.
2. Adicionar Redis para escalar Socket.IO em mais de uma instancia.
3. Implementar observabilidade com metricas de fila e latencia de sync.
4. Adicionar trilha de auditoria por tenant.
