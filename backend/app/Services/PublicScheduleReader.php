<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use DateTimeImmutable;
use DateTimeZone;
use UnexpectedValueException;
final class PublicScheduleReader
{
    public function get(string $slug,string $fulfillment): array
    {
        $db=DB::connection('menu');
        return $db->transaction(function() use($db,$slug,$fulfillment){
            $db->statement('set transaction read only');
            $db->statement("set local statement_timeout = '3s'");
            $db->statement("set local lock_timeout = '1s'");
            $row=$db->selectOne('select to_jsonb(public.pitacco_public_schedule_slots(cast(? as text),cast(? as text))) as payload',[$slug,$fulfillment]);
            $slots=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            if(!is_array($slots)||!array_is_list($slots)||count($slots)>350)throw new UnexpectedValueException('Invalid schedule response');
            return array_map(function($slot){
                if(!is_string($slot)||!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/D',$slot))throw new UnexpectedValueException('Invalid schedule timestamp');
                return (new DateTimeImmutable($slot))->setTimezone(new DateTimeZone('America/Sao_Paulo'))->format('Y-m-d\TH:i:sP');
            },$slots);
        });
    }
}
