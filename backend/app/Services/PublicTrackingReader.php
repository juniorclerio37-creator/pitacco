<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;
final class PublicTrackingReader
{
    public function find(string $token): ?array
    {
        $db=DB::connection('core_tracking');
        return $db->transaction(function() use($db,$token) {
            $db->statement('set transaction read only');
            $db->statement("set local statement_timeout = '3s'");
            $db->statement("set local lock_timeout = '1s'");
            // Original SQL is responsible for expiry, order scope and GPS visibility.
            $row=$db->selectOne('select public.pitacco_track_public_order(cast(? as uuid)) as payload',[$token]);
            if($row===null || $row->payload===null) return null;
            $data=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($data)) throw new UnexpectedValueException('Invalid tracking contract');
            return $data;
        });
    }
}
