<?php
declare(strict_types=1);
require __DIR__.'/../vendor/autoload.php';
use App\Services\LegacyBcrypt;
function check(bool $ok,string $label):void {if(!$ok)throw new RuntimeException($label);}
$password='Senha-fixture-ç-123';
$hash=password_hash($password,PASSWORD_BCRYPT,['cost'=>4]);
foreach(['2a','2b','2y'] as $prefix){
 $legacy='$'.$prefix.substr($hash,3);
 check(LegacyBcrypt::supported($legacy),'Legacy prefix unsupported: '.$prefix);
 check(LegacyBcrypt::verify($password,$legacy),'Legacy correct password rejected: '.$prefix);
 check(!LegacyBcrypt::verify('wrong',$legacy),'Wrong password accepted');
}
foreach([null,'', 'plaintext', '$argon2id$fixture', '$2b$31$'.str_repeat('A',53), substr($hash,0,-1)] as $bad){
 check(!LegacyBcrypt::supported($bad),'Malformed or unsupported hash accepted');
 check(!LegacyBcrypt::verify($password,$bad),'Malformed credential authorized');
}
$max=str_repeat('a',72);$maxhash=password_hash($max,PASSWORD_BCRYPT,['cost'=>4]);
check(LegacyBcrypt::verify($max,$maxhash),'72-byte password rejected');
check(!LegacyBcrypt::verify($max.'b',$maxhash),'Truncated long password accepted');
check(!LegacyBcrypt::verify($max."\0",$maxhash),'NUL accepted');
echo "PASS: synthetic legacy bcrypt prefixes, Unicode, length, unsupported algorithms and fail-closed verification\n";
