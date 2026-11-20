# Pitacco Entregador — GPS em segundo plano (2.0.12)

## Como funciona

O aplicativo Android original `br.com.pitacco.entregador` envia a posição para o Supabase quando o entregador está autenticado, online e ativa o plantão. A loja vê a posição por autorização de sua unidade; os clientes acompanham exclusivamente uma versão aproximada de seu pedido, após a coleta, com token privativo. Nenhuma localização é publicada ao cliente quando a entrega termina, o GPS está desatualizado ou há múltiplas paradas protegidas.

O serviço de localização do Android é um **foreground service de tipo location**: é iniciado com o aplicativo visível, apresenta a notificação persistente **Pitacco Entregador · GPS ativo** e pode continuar enviando coordenadas com a tela apagada ou com o aplicativo minimizado, inclusive durante navegação no Google Maps/Waze. A declaração `ACCESS_BACKGROUND_LOCATION` disponibiliza a configuração opcional **Permitir o tempo todo**, importante para o acesso independente do estado de visibilidade. Isso **não** concede autorização automaticamente e **não** remove os controles de bateria do Android.

## Ativar em um aparelho

1. Instale a **atualização oficial assinada 2.0.12** sobre a versão existente (não instale o APK de teste paralelo).
2. Abra Pitacco Entregador, autorize **Localização precisa**, ative notificações e entre na sua conta.
3. Em **Ajustes > Localização para entregas**, toque em **Permitir localização o tempo todo no Android**; leia a explicação de privacidade e confirme.
4. Nas configurações de Android, vá em **Permissões > Localização > Permitir o tempo todo** e deixe **Usar local exato** ativo; retorne ao aplicativo.
5. Fique **online** e ative o GPS nativo. A notificação permanente informa que o plantão está enviando localização.
6. Se o celular cortar a execução em segundo plano, examine **Configurações > Aplicativos > Pitacco Entregador > Bateria**, evite restrições para o plantão e teste com o dispositivo bloqueado. Essa opção varia por fabricante.

A tela possui **Verificar envio real do GPS**: "GPS ativo" só aparece depois de uma confirmação recente do Supabase. "Aguardando" significa que o serviço está em execução, mas ainda não confirmou o primeiro envio. "Sem sinal" significa que não há confirmação recente, mesmo que o Android ainda tenha o serviço em execução.

**Limites do Android:** forçar a parada do aplicativo em Configurações, cancelar o serviço de localização, retirar a permissão, ficar offline, perder sinal ou sofrer encerramento por economia de energia podem interromper o rastreamento. O serviço não reinicia sozinho após uma parada forçada ou reinicialização do aparelho; reabra o aplicativo e ative o plantão. O rastreamento não deve continuar após desativar o plantão.

## Homologação

Em uma loja teste, atribua um pedido próprio a um entregador com GPS autorizado. Verifique um novo `observed_at` em `courier_positions`, inicialmente com o aplicativo aberto, depois com Home, tela bloqueada e Google Maps/Waze aberto. Compare o marcador do lojista em **Pedidos > Roteirização**, e o ponto aproximado do cliente após a coleta em **Acompanhar pedido**. Ao concluir ou cancelar, a localização pública deve desaparecer. Teste offline e parada forçada para confirmar aviso de GPS desatualizado.

Não use credenciais de sessão de outros usuários nem divulgue posições precisas em páginas públicas; o cliente usa apenas a RPC `pitacco_track_public_order(p_token)`.

## Distribuição

O workflow `.github/workflows/courier-apk.yml` valida que a permissão `ACCESS_BACKGROUND_LOCATION` consta no APK **assinado**, com package `br.com.pitacco.entregador`, versão 2.0.12 e certificado oficial já configurado. O APK `-TESTE-PARALELO` usa um ID e uma assinatura distintos, apenas para homologação isolada.


## Homologação da próxima versão 2.0.13 (NÃO PUBLICADA)

Esta melhoria está apenas na branch `feat/entregador-atividade-fisica-20261120` e num pull request **rascunho**. Não fazer merge, release nem distribuição até a revisão da próxima foto do usuário.

### Atividade física opcional

Na versão **2.0.13**, a tela **Ajustes → Permissões e rastreamento** possui **um único botão “Permissões do Android”**. Ele abre as configurações do aplicativo no sistema operacional, onde o entregador pode autorizar localização precisa, localização o tempo todo, atividade física e notificações. O app não solicita tudo de uma vez; as permissões continuam sendo controladas individualmente pelo Android. A atividade física permite identificar localmente transições entre **parado, caminhada, bicicleta e em veículo**. A recusa não impede login, recebimento de pedidos ou GPS tradicional.

Durante um plantão ativo, o serviço Android registra a API **Google Activity Transition** via um `PendingIntent` explícito para `CourierMotionReceiver` (`exported=false`). As transições ficam somente no celular; não são enviadas ao Supabase nem ao cliente. Ao sair do plantão, a assinatura é removida e o estado local é limpo. Sem permissão ou Google Play Services funcional, a frequência original permanece.

- Movimento identificado (ou desconhecido): intervalo mínimo de envio GPS **12 segundos**.
- **Parado por pelo menos 60 segundos**: mínimo de **45 segundos** entre envios, preservando localização recente no mapa.
- GPS indicando velocidade acima de 1,5 m/s: priorizar 12 segundos mesmo se o classificador indicar parado.
- Os estados são auxiliares e **não confirmam chegada, coleta ou entrega**.
- Essa primeira otimização reduz transmissões de rede e processamento; não desliga o receptor GPS, porque o funcionamento do rastreio em segundo plano é prioritário. O ganho real de bateria deve ser medido no aparelho.

### Regressão do botão Ficar offline

A tela do entregador não deve chamar `.catch()` diretamente sobre o retorno `PostgrestBuilder` de `sb.rpc()`. Após a RPC `pitacco_driver_online(false)` funcionar, deve cancelar a observação de GPS no navegador imediatamente, enviar o comando de parada ao serviço Android, solicitar revogação segura via Supabase e atualizar a disponibilidade. A falha temporária de limpeza remota não deve travar a tela; a capacidade GPS também é revogada automaticamente pelo mecanismo do banco ao ficar offline.

**Testes no celular antes de liberar**: online → off → online, com o app aberto, minimizado, Waze aberto e tela bloqueada; verificar ausência de coordenadas novas após ficar offline; verificar permissão recusada, movimento, parado prolongado, retomada do movimento e bateria. Solicitar ao usuário a foto do erro para reconciliar qualquer outro defeito visual ou de navegação.

### GPS automático e interface simplificada

- **Ficar online**: o Pitacco verifica a sessão e inicia automaticamente o serviço GPS nativo (com localização autorizada); não há botão separado de ativação.
- **Já estava online ao abrir**: após carregar o cadastro e confirmar a sessão, o app retoma automaticamente o rastreamento, sem solicitar uma nova ação de plantão.
- **Ficar offline**: após confirmar o estado no servidor, interrompe o GPS do navegador, para o serviço nativo e revoga a capacidade de rastreamento. Não há botão separado de parada na tela.
- **Falha temporária de rede**: não criar capacidades duplicadas em atualizações sucessivas; controlar tentativas e impedir que uma resposta atrasada religue um plantão encerrado.
- **Android sem serviço nativo**: preservar o caminho de geolocalização da versão web no navegador. As informações de GPS mostram se o serviço está aguardando, ativo ou desatualizado.
- **Alertas e sons**: permanecem em uma seção expansível “Diagnósticos e som de alertas”, recolhida por padrão. Não remover suas funcionalidades.

**Importante:** a versão 2.0.13 permanece em *pull request rascunho*, sem APK oficial e sem implantação na produção até nova aprovação. O Android pode restringir o serviço em segundo plano conforme as permissões e bateria; validar em aparelho real antes de anunciar rastreamento garantido.
