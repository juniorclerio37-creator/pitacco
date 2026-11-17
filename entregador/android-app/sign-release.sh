#!/usr/bin/env bash
set -euo pipefail

unsigned_apk=${1:?Informe o APK compilado}
output_dir=${2:?Informe a pasta de saída}
sdk=${ANDROID_HOME:?Informe ANDROID_HOME}/build-tools/35.0.0
: "${PITACCO_ANDROID_KEYSTORE:?Informe o caminho do keystore}"
: "${PITACCO_ANDROID_KEY_ALIAS:?Informe o alias da chave}"
: "${PITACCO_ANDROID_KEYSTORE_PASSWORD:?Informe a senha do keystore}"
: "${PITACCO_ANDROID_KEY_PASSWORD:?Informe a senha da chave}"
: "${PITACCO_ANDROID_CERT_SHA256:?Informe o SHA-256 esperado do certificado}"

expected=$(printf '%s' "$PITACCO_ANDROID_CERT_SHA256" | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')
if [[ ! $expected =~ ^[0-9a-f]{64}$ ]]; then
  echo 'A impressão digital esperada do certificado deve ser um SHA-256.' >&2
  exit 1
fi

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT

"$sdk/zipalign" -P 16 -f 4 "$unsigned_apk" "$scratch/aligned.apk"
"$sdk/apksigner" sign \
  --ks "$PITACCO_ANDROID_KEYSTORE" --ks-key-alias "$PITACCO_ANDROID_KEY_ALIAS" \
  --ks-pass env:PITACCO_ANDROID_KEYSTORE_PASSWORD --key-pass env:PITACCO_ANDROID_KEY_PASSWORD \
  --out "$scratch/signed.apk" "$scratch/aligned.apk"
report=$("$sdk/apksigner" verify --verbose --print-certs "$scratch/signed.apk")
mapfile -t certificates < <(printf '%s\n' "$report" | sed -nE 's/^Signer #[0-9]+ certificate SHA-256 digest: ([0-9a-f]+)$/\1/p')
if [[ ${#certificates[@]} != 1 || ${certificates[0]:-} != "$expected" ]]; then
  echo 'A assinatura do APK difere do certificado oficial configurado.' >&2
  exit 1
fi

version=$("$sdk/aapt" dump badging "$scratch/signed.apk" |
  sed -nE "s/^package: name='br[.]com[.]pitacco[.]entregador'.*versionName='([0-9]+[.][0-9]+[.][0-9]+)'.*/\1/p")
if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo 'Pacote ou versão Android inválidos para publicação estável.' >&2
  exit 1
fi
mkdir -p "$output_dir"
filename="Pitacco-Entregador-$version.apk"
mv "$scratch/signed.apk" "$output_dir/$filename"
printf '%s\n' "$report" > "$output_dir/ASSINATURA-ANDROID.txt"
(cd "$output_dir" && sha256sum "$filename" > SHA256-ANDROID.txt)
