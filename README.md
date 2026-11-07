# O meu olhar

## Developers and AI

Start with [contributor rules](docs/CONTRIBUTING.md),
[architecture and sources of truth](docs/ARCHITECTURE.md),
[commands and local/manual testing](docs/TESTING.md) and
[PRs, versioning and releases](docs/RELEASES.md). Every commit requires meaningful documentation.
Use feature branches, strict checks and reviewed squash PRs to main.

The current version is in `package.json` and the app footer; released versions use immutable
`vX.Y.Z` tags. See [CHANGELOG.md](CHANGELOG.md).

Prancha de comunicação **pt-PT**, pensada primeiro para Safari no **iPad A16**. Quatro botões
grandes dizem palavras/frases. Funciona por toque e inclui um **protótipo experimental de seleção
pelo olhar**, com a câmara frontal.

## O que está incluído

- Quatro frases configuráveis, inicialmente «Sim», «Não», «Quero água» e «Preciso de ajuda».
- «Escolher outra frase»: catálogo paginado com quatro frases de cada vez. Escolha uma frase e
  depois um dos quatro botões a substituir. Todo este percurso funciona por toque ou olhar, sem
  teclado.
- «Adicionar frase»: área de escrita para quem acompanha; guarda até 100 caracteres por frase. O
  olhar é desligado antes de abrir o teclado.
- 28 frases pt-PT iniciais. Frases novas e botões são guardados em `localStorage`. Não existe conta,
  base de dados, sincronização entre dispositivos ou recolha de imagens.
- Voz do sistema, preferindo uma voz **pt-PT**. Não utiliza serviços de voz externos.
- Calibração automática de nove pontos e verificação de quatro pontos. Seleção após **2 segundos**
  contínuos. A barra dourada mostra o progresso. É necessário olhar para fora do botão durante 400
  ms antes da próxima seleção.
- Câmara desligada ao sair da página, mudar o tamanho/orientação, deslocar a página ou abrir a
  escrita. É necessário recalibrar.

## Limites importantes

**Não é um dispositivo médico nem um sistema fiável de comunicação de emergência.** Uma câmara
normal de iPad não equivale a um aparelho dedicado de eye tracking. MediaPipe identifica rosto e
íris; uma regressão calibrada estima a posição no ecrã a partir desses sinais. Não há uma garantia
de precisão, e a aplicação pode não funcionar com certas posições, movimentos oculares ou condições
de iluminação. Não exige mover a cabeça para calibrar, mas o desempenho com movimentos apenas dos
olhos tem de ser confirmado no dispositivo e com a pessoa que o irá utilizar.

O olhar só fica ativo se **cada** ponto de verificação tiver pelo menos 12 amostras e 90% delas
apresentarem erro de, no máximo, 12% da largura e 12% da altura do ecrã. É apenas uma verificação
inicial: não prova a precisão contínua. Ausência de rosto, mais de um rosto, olhos fechados, imagem
parada ou dados fora do intervalo calibrado interrompem a seleção. Uma deteção errada ainda pode
escolher uma frase incorreta. Se existirem erros, desligue o olhar e use outro meio de comunicação
com acompanhamento.

Safari pode bloquear fala iniciada sem um toque recente. «Testar som» e «Ativar olhar» iniciam voz
por toque, mas isso **não garante** autorização permanente. Falhas de voz e ausência de uma voz
pt-PT confirmada aparecem no ecrã. Verifique uma voz portuguesa nas definições de
acessibilidade/conteúdo falado do iPad, o volume e a saída de áudio. Ouça o sotaque real antes de
utilizar.

As frases persistem só neste navegador e origem. Mudar de domínio, limpar os dados, usar navegação
privada ou perder o dispositivo pode eliminá-las. Não escreva informação confidencial: nesta
primeira versão não existe encriptação nem exportação. Dados inválidos existentes não são
silenciosamente substituídos.

## Desenvolvimento

Requer Node.js **22.22.2 ou superior** e npm. Node só é necessário para construir e publicar; o site
final é estático (TypeScript + Vite, sem framework de interface).

```sh
npm ci
npm run dev
```

Abra o endereço local apresentado pelo Vite. `localhost` permite câmara no computador. Para testar a
câmara **no iPad**, use o endereço **HTTPS** de Cloudflare; um IP local com HTTP não tem permissão
de câmara.

```sh
npm test
npm run build
```

A instalação copia o WASM de MediaPipe e descarrega o modelo Face Landmarker float16 v1 (~3,8 MB) do
armazenamento oficial Google, verificando o SHA-256. É preciso internet durante a primeira
instalação. Os ficheiros gerados ficam em `public/vision/`, são ignorados pelo Git e entram em
`dist/` durante a construção. No navegador, o modelo e WASM são servidos **do próprio site**, não de
um CDN. Nenhum vídeo é enviado para um servidor. A deteção é limitada a cerca de 12 imagens/s na
thread principal; teste fluidez, temperatura e bateria no iPad.

## Publicar com Cloudflare e GitHub

Use **Cloudflare Workers Static Assets**, publicados por **GitHub Actions** em dois Workers.
«Cloudflare Pipelines» é ingestão de dados e não é usado. **Workers Builds deve estar desligado**: a
ligação antiga de `main` a PROD contornaria a aprovação manual.

Siga o [guia de configuração, recuperação e verificação](docs/DEPLOYMENT.md), também reutilizável
para novas aplicações estáticas. **Antes de ativar os workflows, confirme que `main` já existe no
GitHub e é a branch predefinida.** Depois de guardar a configuração Cloudflare, recarregue o painel
e confirme os dois Workers e os ambientes GitHub; definições externas não mudam só por editar YAML.

Cada squash merge em `main` valida e publica **apenas TEST**. Só depois de sucesso cria uma tag
`vX.Y.Z` e uma GitHub prerelease com notas automáticas. Após testar, execute **Deploy to PROD** com
essa tag: valida a proveniência e publica o mesmo artefacto, sem reconstrução; só depois torna a
mesma release estável. Consulte o guia para configurar tokens, URLs e aprovação de `production`.

Aplicação publicada: <https://button-eye-reader.cgcnnunes.workers.dev>. Escolha a origem definitiva
antes de guardar frases; mudar de domínio não transfere `localStorage`.

Alternativa local autenticada para **TEST apenas**, sem criar uma prerelease elegível:

```sh
npx wrangler login
npm run deploy
```

Para outra conta ou aplicação, configure os Workers e GitHub Environments seguindo o guia. Não
existe autenticação Cloudflare ou GitHub incluída no projeto.

## Primeiro teste no iPad (com acompanhamento)

1. Use Safari atualizado, modo normal, zoom de página 100%, sem Split View. Prefira a orientação
   horizontal; a vertical também tem uma grelha 2 × 2.
2. Monte o iPad num suporte fixo, ao nível dos olhos, com luz uniforme. Só a pessoa utilizadora deve
   aparecer na câmara. Não altere a distância depois de calibrar.
3. Toque em «Testar som». Confirme voz pt-PT, volume e saída de áudio.
4. Teste por toque as quatro frases, uma substituição no catálogo, uma frase nova e a persistência
   depois de recarregar.
5. Toque em «Ativar olhar», autorize a câmara e peça à pessoa que siga o centro do círculo com os
   olhos, sem precisar de tocar. Demora cerca de 40 segundos se estável.
6. Depois da verificação, olhe para fora do último círculo. Teste **cada** botão várias vezes.
   Confirme que não fala antes de dois segundos, que não repete sem desviar o olhar, e que olhar
   para espaços vazios não ativa nada.
7. Teste «Escolher outra frase», «Seguinte/Anterior», seleção e substituição apenas pelo olhar.
   Confirme também pausas ao fechar os olhos ou entrar outro rosto.
8. Mude a orientação/saia e regresse: a câmara deve desligar e exigir recalibração. Faça uma sessão
   acompanhada mais longa para detetar deriva e falhas de áudio.

Os testes automatizados cobrem dados, regressão, limites de verificação, dwell, ciclo de vida da
câmara e erros de voz. Não validam precisão ocular, sotaque, permissões ou desempenho no iPad
físico: esses pontos são critérios de aceitação antes de depender do protótipo.

## Estrutura / extensões

- `src/main.ts`: interface e percurso de catálogo/substituição.
- `src/store.ts`: frases iniciais, validação e alterações imutáveis dos quatro botões.
- `src/dwell.ts`: seleção temporizada, margem de segurança e bloqueio de repetição.
- `src/gaze.ts` / `src/gaze-math.ts`: câmara, landmarks e calibração.
- `src/speech.ts`: voz pt-PT, prevenção de filas e erros de áudio.
- `src/style.css`: tipografia, espaçamento e grelha iPad.

Para manter poucos alvos no ecrã, futuras opções devem usar páginas de quatro elementos em vez de
aumentar o número de botões da prancha principal.

Referências: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/),
[Static Assets](https://developers.cloudflare.com/workers/static-assets/),
[MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker).
