<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use UnexpectedValueException;
final class FiadoStatement
{
    public function read(string $slug,array $data): ?array
    {
        $db=DB::connection('core_fiado_statement');
        return $db->transaction(function() use($db,$slug,$data) {
            $db->statement("set local statement_timeout = '5s'");
            $db->statement("set local lock_timeout = '2s'");
            $verified=json_decode($db->selectOne('select public.pitacco_fiado_verify_pin(cast(? as text),cast(? as text),cast(? as text),cast(? as uuid)) as payload',[$slug,$data['phone'],$data['pin'],(string)Str::uuid()])->payload,true,512,JSON_THROW_ON_ERROR);
            // Returning normally commits the original failed-attempt counter.
            if(($verified['verified']??false)!==true || !isset($verified['token'])) return null;
            // Consume the original one-time verification internally. Never return it.
            $result=json_decode($db->selectOne('select public.pitacco_v2_fiado_statement(cast(? as text),cast(? as uuid)) as payload',[$slug,$verified['token']])->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($result)||isset($result['error'])||!isset($result['outstanding'],$result['charges'],$result['payments'])) throw new UnexpectedValueException('Invalid statement contract');
            return array_intersect_key($result,array_flip(['outstanding','next_due','charges','payments','pix_instructions']));
        });
    }
}
