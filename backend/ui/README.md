### Ensaio local do quadro e da reimpressão

Use o banco sintético do workflow Core, habilite as opções experimentais de ações e impressão e inicie a API Laravel em `127.0.0.1:8080`. Gere o frontend descartável com `python3 backend/scripts/prepare-map-ui.py /caminho/temporario/web`. Nesse diretório, rode `npm ci`, troque `/src.jsx` por `/core-preview.jsx` no index.html e rode `npx vite --config core-preview.vite.config.mjs`. Essa configuração escuta somente no loopback e encaminha a API ao Laravel local. Use as credenciais sintéticas do workflow.

Cartões de pedidos próprios e iFood aceitos solicitam reimpressão pela fila de teste existente. Em nova tentativa na mesma sessão após resposta inconclusiva, o painel reaproveita o identificador da solicitação. Teste de fila não confirma saída em papel. O ensaio padrão não inicia a ponte nativa nem o consumidor iFood.
