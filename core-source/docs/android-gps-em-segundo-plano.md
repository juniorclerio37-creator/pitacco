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
