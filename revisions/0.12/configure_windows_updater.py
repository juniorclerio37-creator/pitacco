"""Prepare the free, cryptographically-signed Tauri in-app updater on build runners.

Tauri update signing is NOT the paid Windows Authenticode certificate.
Without configured keys this script leaves the existing NSIS installer unchanged.
"""
import json
import os
from pathlib import Path

config_path=Path('web/src-tauri/tauri.conf.json')
config=json.loads(config_path.read_text(encoding='utf-8'))
public_key=os.getenv('PITACCO_TAURI_UPDATER_PUBLIC_KEY','').strip()
private_key=os.getenv('TAURI_SIGNING_PRIVATE_KEY','').strip()
if bool(public_key)!=bool(private_key):
    raise SystemExit('Chave publica e chave privada do atualizador precisam ser configuradas juntas.')
if public_key and private_key:
    config['bundle']['createUpdaterArtifacts']=True
    config.setdefault('plugins',{})['updater']={
        'pubkey':public_key,
        'endpoints':['https://github.com/juniorclerio37-creator/pitacco/releases/latest/download/latest.json'],
        'windows':{'installMode':'passive'}
    }
    config_path.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Atualizador Tauri assinado habilitado para este build.')
else:
    print('Atualizador Tauri indisponivel: instale a versao sobre a anterior sem desinstalar.')

# The update lease and both queue guards are applied by safe_windows_auto_update.py during source restoration.
