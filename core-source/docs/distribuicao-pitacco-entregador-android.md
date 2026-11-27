# Distribuição estável do Pitacco Entregador no Android

Aplicativo `br.com.pitacco.entregador`. As compilações de teste e estável têm o mesmo identificador. O Android distingue as duas pelas assinaturas. Em um aparelho de homologação que já tenha o APK de teste, será preciso desinstalá-lo antes de instalar o estável assinado com outra chave. A conta e as entregas continuam no servidor.

## Configurar o GitHub Actions

Em **Settings → Secrets and variables → Actions**, configure:

| Nome | Tipo | Conteúdo |
| --- | --- | --- |
| `PITACCO_FIREBASE_ANDROID_JSON` | Segredo | Configuração do aplicativo Android obtida no Firebase |
| `PITACCO_ANDROID_KEYSTORE_BASE64` | Segredo | Keystore de distribuição codificado em Base64 |
| `PITACCO_ANDROID_KEYSTORE_PASSWORD` | Segredo | Senha do keystore |
| `PITACCO_ANDROID_KEY_ALIAS` | Segredo | Alias da chave Android |
| `PITACCO_ANDROID_KEY_PASSWORD` | Segredo | Senha da chave |
| `PITACCO_ANDROID_CERT_SHA256` | Variável | Impressão digital SHA-256 do certificado oficial |

Guarde uma cópia segura do keystore e mantenha a mesma chave de distribuição nas próximas versões. Na compilação, o GitHub Actions rejeita a assinatura de outro certificado. A opção **estavel** está disponível em **Actions → Pitacco Entregador APK → Run workflow**, usando a branch `main`.

## Publicar

1. Baixe o artefato **Pitacco-Entregador-Android-estavel** do GitHub Actions. Ele contém o APK, o relatório de assinatura e o SHA-256.
2. Em **Super Admin → Central de Aplicativos**, selecione **Pitacco Entregador Android** e **Estável**. Envie o APK com o SHA-256 correspondente.
3. Revise o instalador e publique a versão. O botão de download do login web usa a versão Android estável vigente.

O push de novas atribuições também exige [a ativação do envio no Supabase](ativacao-push-entregador-android.md). A assinatura oficial do Windows é independente. O workflow **Pitacco Windows** usa `PITACCO_SIGN_PFX_BASE64` e `PITACCO_SIGN_PFX_PASSWORD`.
