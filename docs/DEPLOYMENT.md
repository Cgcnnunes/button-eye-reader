# Publicar com Cloudflare e GitHub

Guia para pessoas e agentes de IA: **GitHub Actions publica Workers Static Assets em dois Workers
independentes**. Workers Builds já não publica este projeto; Cloudflare Pipelines é ingestão de
dados e não é usado.

- Squash merge em `main` → validações → Worker TEST → smoke tests → artefacto → tag `vX.Y.Z` e
  GitHub **prerelease**, com notas geradas desde a última release estável.
- Dispatch de **Deploy to PROD** com essa tag → validação de proveniência → aprovação do ambiente →
  download do mesmo artefacto → Worker PROD → smoke tests → a mesma release torna-se estável.

PROD não é publicado por push, merge ou criação de tags. Não há reconstrução do site para PROD.

## 1. Migração obrigatória antes do próximo merge

**Primeiro desligue a publicação automática antiga.** No Worker existente `button-eye-reader`, abra
**Settings → Builds / Build** e desligue/desconecte a integração GitHub Workers Builds. Desativar
apenas Preview builds não basta. Não elimine o Worker, domínio ou deployment atual.

Recarregue o painel e confirme que não existe uma ligação que publique `main` em PROD, nem deploy
hooks ativos. Se existirem construções antigas em execução/fila, cancele-as e confirme que
terminaram antes de avançar. Não elimine integrações ou hooks de outras aplicações.

Sem esta ação no painel, a integração antiga continuaria a publicar merges em PROD, mesmo com estes
workflows. Ficheiros YAML não conseguem desativar essa ligação externa.

## 2. Preparar o repositório e os Workers

- Envie o projeto para GitHub, incluindo `package-lock.json` e `wrangler.jsonc`. Não envie
  `node_modules`, `dist`, modelos gerados, tokens ou credenciais.
- Confirme no GitHub que **`main` existe no remoto, contém a aplicação e é a branch predefinida**.
  Não use uma branch provisória como fonte dos workflows.
- Mantenha o Worker PROD existente **`button-eye-reader`**. Crie em **Workers & Pages → Create
  application** um Worker TEST **`button-eye-reader-test`**, usando o fluxo sem ligação GitHub (por
  exemplo, o Worker inicial/Hello World). Não ligue Workers Builds a nenhum dos dois. O primeiro
  deploy GitHub substituirá o conteúdo inicial do TEST.
- Ative o endereço `workers.dev` de cada Worker e copie os dois endereços HTTPS reais do painel.
  Neste projeto, PROD é <https://button-eye-reader.cgcnnunes.workers.dev>; confirme o endereço TEST
  no painel em vez de o adivinhar.
- Mantenha estes endereços acessíveis sem Cloudflare Access nesta configuração. Os smoke tests
  verificam respostas públicas; proteger TEST com Access exigiria autenticação de serviço adicional
  nos workflows. Não partilhe frases confidenciais nos testes.
- Confirme os nomes em `wrangler.jsonc`: `env.test.name` é `button-eye-reader-test`;
  `env.production.name` é `button-eye-reader`. `workers_dev: true` e `preview_urls: false` são
  explícitos; TEST tem um endereço permanente, não uma Preview URL por versão.
- Confirme que `assets.directory` corresponde à saída da construção (`./dist` neste projeto).
- Com Node compatível com `.nvmrc` e `package.json`, execute `npm ci` e `npm run verify`. Não
  desative testes, lint, hooks ou verificação de assets para contornar uma falha.

Ao reutilizar este guia para **outra aplicação**, substitua os nomes também nas verificações de
`scripts/deployment-policy.ts` e nos testes, além da configuração Wrangler. Não copie tokens,
identificadores de conta ou endereços deste projeto. Recursos futuros, como bases de dados ou
bindings, devem ter configurações TEST/PROD separadas; dois Workers não isolam automaticamente
recursos partilhados.

## 3. Tokens e ambientes GitHub

### Token e permissões

Em Cloudflare **My Profile → API Tokens**, crie tokens de publicação, preferencialmente distintos
para TEST e PROD, com **Account → Workers Scripts → Edit** limitado à conta correta. Para este site
`workers.dev`, não são necessárias permissões de edição de zonas/domínios. Se os logs indicarem
outra permissão necessária, acrescente só essa permissão. Esta permissão é de conta, não uma
garantia de isolamento por Worker: tokens distintos melhoram a gestão/revogação, mas não impedem por
si só que um token da mesma conta altere outro Worker. Nunca dê credenciais PROD a jobs de PR.

O formulário pode avisar que faltam permissões de produtos como AI, Containers, Browser Rendering,
Email ou Secrets Store. **Não alargue permissões apenas para eliminar esse aviso**: esta aplicação
estática não usa esses produtos. Só altere o token se os logs indicarem falta de uma permissão
necessária à publicação; limite-a ao serviço e conta necessários. Tokens eliminados, expirados ou
rodados devem ser substituídos nos segredos do ambiente GitHub correspondente.

No repositório GitHub, **Settings → Environments**, crie exatamente **`test`** e **`production`**.
Em **cada ambiente**, configure:

- Secret **`CLOUDFLARE_ACCOUNT_ID`**: identificador da conta onde estão os Workers.
- Secret **`CLOUDFLARE_API_TOKEN`**: token do respetivo ambiente.
- Variable **`DEPLOYMENT_URL`**: raiz HTTPS `workers.dev` do respetivo Worker, sem caminho, query ou
  fragmento. O workflow verifica que coincide com a URL devolvida pelo Wrangler.

Use segredos de **ambiente**, não segredos globais com credenciais PROD. `GITHUB_TOKEN` é fornecido
automaticamente pelo GitHub; não crie um PAT para os workflows.

Restrinja ambos os ambientes a execuções de **`main`**. Em `production`, configure required
reviewers e impeça autoaprovação, se o plano GitHub o permitir. O dispatch usa o workflow de `main`
como mecanismo de controlo, mas publica exclusivamente o commit da tag selecionada. Se o
plano/repositório não permitir required reviewers, o dispatch continua manual, mas não existe a
segunda aprovação obrigatória; não apresente essa proteção como ativa.

Em **Settings → Actions**, permita os workflows e os actions utilizados. Os jobs declaram as
permissões necessárias: TEST precisa de `contents: write` e `actions: read`; PROD usa leitura para
validar e escrita só no job protegido que promove a release. Permita criação de tags/releases pelo
bot; proteja tags contra alteração/eliminação sem bloquear a sua criação autorizada. Mantenha `main`
protegido por PR, squash-only e `Validate / validate` obrigatório.

Node vem de `.nvmrc` via `actions/setup-node`; já não é necessário `NODE_VERSION` em Workers Builds.
TEST usa `npm ci` com scripts para preparar modelo/WASM. PROD usa `npm ci --ignore-scripts`
intencionalmente: instala apenas ferramentas e reutiliza `dist` do TEST, sem reconstruir assets.

Nunca partilhe o valor de `CLOUDFLARE_API_TOKEN`, capturas com segredos ou URLs de deploy hooks.
Autorize GitHub/Cloudflare diretamente na página de autenticação, não através do chat.

## 4. Primeiro merge e aceitação TEST

Depois da migração do painel e dos segredos, faça squash merge da PR destes workflows. Em **Actions
→ Deploy to TEST** (`deploy-to-test.yml`), confirme:

1. Checkout do squash SHA, `npm run verify` e sucesso de `Validate` no mesmo commit de `main`.
2. Publicação com `--env test`, sem publicação PROD.
3. Smoke tests da URL TEST: marcador `release.json` com SHA/tag, bytes exatos do HTML/modelo/WASM,
   MIME WASM e cabeçalhos de segurança.
4. Artefacto `tested-site-<run-id>-<attempt>`, com retenção de 90 dias.
5. Tag anotada imutável `vX.Y.Z` e GitHub prerelease com notas automáticas desde a última release
   estável, link TEST e proveniência da execução/artefacto.

Espere a execução terminar com sucesso, não apenas aparecer a tag. TEST é um endereço permanente:
merges seguintes substituem o conteúdo, mas cada prerelease conserva o seu artefacto. Teste no iPad
e registe **tag, SHA e resultados** antes do merge seguinte; o marcador identifica a versão
atualmente no TEST. Não aprove uma tag antiga com base num TEST que já serve outra tag.

Os checks automáticos não provam precisão ocular, voz pt-PT ou aceitação humana. Use
[TESTING.md](TESTING.md), com frases de teste não confidenciais.

## 5. Publicar PROD exclusivamente pela tag

1. Abra **Actions → Deploy to PROD** (`deploy-to-prod.yml`) → **Run workflow**.
2. Use o workflow de **`main`** e preencha **`tag`**, por exemplo `v0.2.0`, com a prerelease TEST
   efetivamente testada. Branches, SHAs, tags leves, releases estáveis e tags sem proveniência não
   são elegíveis. Marque **`test_approved`** para confirmar que testou esse SHA/tag; sem essa
   confirmação o workflow falha antes de publicar.
3. O primeiro job valida tag/ancestralidade em `main`, versão dos manifests, prerelease, sucesso da
   tentativa TEST exata, sucesso do último `Validate` desse SHA, ID/digest e validade do artefacto.
   Também impede regressão para uma versão igual/inferior à última release estável.
4. Reveja e aprove o ambiente `production`, se configurado. As verificações são repetidas depois da
   aprovação para detetar mudanças durante a espera.
5. O job descarrega o ZIP original, verifica o SHA-256 e o marcador, publica com `--env production`
   e testa o endereço PROD. **Não executa Vite nem recompila o site.**
6. Só depois a mesma GitHub release perde a marca prerelease e passa a latest. A tag não muda.

PROD tem uma fila própria, sem cancelamento de uma publicação em curso. GitHub concurrency não
garante FIFO de todas as execuções pendentes; aguarde o fim do TEST antes do merge seguinte e
promova uma release de cada vez. Não use pushes diretos a `main`: podem executar `Validate`, mas não
produzem uma prerelease TEST elegível.

## 4. Recuperar de falhas

Leia os **logs GitHub Actions** da validação, instalação, construção e publicação. Avisos da consola
do navegador do dashboard não são necessariamente falhas da aplicação.

- **`error occurred while fetching repository`:** confirme primeiro a branch nos metadados e se
  existe no GitHub. Se estiver correta, confirme acesso da integração ao repositório, sobretudo se
  for privado.
- **Retry volta a usar uma branch eliminada:** crie uma construção nova da branch correta; não
  continue a repetir a construção antiga.
- **Nome do Worker não corresponde:** compare o Worker selecionado com `name` no Wrangler do
  diretório configurado.
- **Wrangler não encontra configuração ou assets:** confirme o diretório raiz, a existência da
  configuração e que TEST criou `dist`, ou que PROD descarregou o artefacto.
- **Node incompatível ou falha ao executar scripts `.ts`:** confirme a versão detetada nos logs e
  `.nvmrc` e `actions/setup-node`.
- **Erro de autenticação/permissão ao publicar:** confirme conta, validade e seleção do token.
  Corrija apenas a permissão indicada nos logs.
- **Modelo/WASM não preparado:** leia o erro de `postinstall`/`assets`, incluindo download e
  checksum; não ignore o script.
- **Testes, lint, formato ou build falham:** reproduza o comando localmente e corrija a causa
  através do processo normal de PR.
- **Site antigo apesar de construção iniciada:** confirme que a fase de publicação terminou com
  sucesso e que abriu o endereço de produção correto.
- **Artefacto expirado/eliminado ou digest diferente:** a promoção é bloqueada; não reconstrua
  arbitrariamente a tag para PROD. Reexecute TEST para a mesma prerelease, se ainda não estável, e
  repita a aceitação humana antes de promover.
- **TEST falha antes da tag:** corrija a causa e reexecute a execução original ou uma nova PR. PROD
  mantém o deployment anterior.
- **Tag criada mas release falha:** não mova/elimine a tag; reexecute o workflow original. A
  recuperação aceita apenas a tag no mesmo SHA. Se já houver uma prerelease, atualiza a proveniência
  só após novo TEST bem-sucedido.
- **PROD publicado mas smoke test/promoção GitHub falha:** PROD pode já ter mudado. Não é um
  rollback automático nem uma transação entre fornecedores. Investigue a versão pública e reexecute
  a mesma promoção enquanto a release continuar prerelease. Depois de estável, redispatch é
  bloqueado. Um rollback de emergência exige autorização e procedimento próprio, não uma tag antiga
  escolhida neste workflow de promoção.

### Branch corrigida, mas a construção antiga continua em `master`

Esta é uma lição da **configuração antiga com Workers Builds**, não um procedimento a usar agora
para PROD. Na primeira configuração, Cloudflare conservou `master` depois da migração GitHub para
`main`. Mesmo após guardar `main` nas definições, **Retry build da construção antiga voltou a usar
`master`** e falhou na clonagem. Não presuma que Retry muda a branch/commit da construção original,
mesmo quando aplica definições de construção atualizadas.

1. Guarde `main` como branch de produção e confirme após recarregar.
2. Prefira a próxima alteração real, publicada pelo processo normal de PR, para iniciar uma nova
   construção. Não crie commits vazios só para desencadear a pipeline.
3. Se precisar de publicar já, sem mudar código, pode criar um **deploy hook temporário** nas
   definições de Builds, selecionando explicitamente `main`. Obtenha autorização antes de criar ou
   acionar o hook; uma chamada pode publicar imediatamente o conteúdo dessa branch.
4. Acione o hook uma única vez por POST, seguindo as instruções do painel. Trate a URL como segredo.
   Uma resposta bloqueada por CORS no navegador **não prova que o POST falhou**: confirme **Last
   triggered** e a atividade de construções antes de repetir, evitando duplicados.
5. Confirme uma nova construção de `main` e acompanhe-a até ao fim.
6. Elimine o hook temporário; guarde se necessário e recarregue. Confirme **No deploy hooks
   defined**, ou a ausência desse hook se existirem outros legítimos. Não elimine hooks alheios.

O hook temporário usado na recuperação deste projeto foi eliminado. Neste processo GitHub Actions,
não recrie hooks nem volte a ligar Workers Builds: isso contornaria a promoção manual.

## 5. Verificar a publicação, não apenas a construção

- Confirme nos logs instalação, `npm run verify`, upload dos assets, publicação e mensagem final de
  sucesso. Uma construção iniciada ou testes verdes, isoladamente, não significam site publicado.
- Copie o endereço HTTPS de produção indicado nos logs/painel; não adivinhe o subdomínio da conta
  nem use uma Preview URL como endereço definitivo.
- Abra o site e confirme título, versão no rodapé, quatro frases e os dois controlos do catálogo.
- Confirme que o modelo e os dois WASM em `vision/` são servidos com sucesso, não como HTML de
  fallback. Os WASM devem ter `Content-Type: application/wasm`.
- Confirme CSP e Permissions Policy na resposta do site: câmara permitida apenas à própria origem,
  microfone e geolocalização desativados.
- No iPad, teste som, catálogo, persistência e calibração conforme [TESTING.md](TESTING.md).
  Verificação no computador não estabelece precisão ocular nem disponibilidade de voz no iPad.

Primeira publicação antiga verificada: **v0.1.0**, em `main`, em 7 de novembro de 2026. Essa release
não tem proveniência TEST e não é elegível para o novo workflow PROD. Endereço deste projeto:
<https://button-eye-reader.cgcnnunes.workers.dev>. Antes de guardar frases, escolha o domínio
definitivo: `localStorage` não migra entre origens.

## Referências e manutenção

- [Configuração oficial de Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Diagnóstico oficial de Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/)
- [Arquitetura e fontes de verdade](ARCHITECTURE.md)
- [Regras de contribuição](CONTRIBUTING.md)

O Wrangler define identidade/assets/ambientes; GitHub Actions define os comandos e promoção; GitHub
Environments define segredos, URLs e aprovações. A ausência de Workers Builds é uma ação externa
obrigatória. Mantenha estas superfícies coerentes e não apresente configurações de painel como
garantidas apenas porque constam do repositório.
