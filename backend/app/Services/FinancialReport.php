<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;
final class FinancialReport
{
    public function read(object $session,string $store,string $start,string $end): array
    {
        $db=DB::connection('core_financial_read');
        return $db->transaction(function() use($db,$session,$store,$start,$end){
            $db->statement('set transaction read only');
            $db->statement("set local statement_timeout = '3s'");
            $db->statement("set local lock_timeout = '1s'");
            $db->selectOne("select set_config('request.jwt.claim.sub', ?, true), set_config('request.jwt.claims', ?, true), set_config('pitacco.core_session_id', ?, true)",[
                $session->user_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated','aal'=>'aal1'],JSON_THROW_ON_ERROR),$session->session_id
            ]);
            $allowed=$db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store]);
            abort_unless($allowed?->allowed,404);
            $rows=$db->select('select metric,channel,amount,entries from public.pitacco_period_financial_report(cast(? as uuid),cast(? as date),cast(? as date)) order by metric,channel',[$store,$start,$end]);
            // Preserve original aggregates and decimal precision. Never sum distinct metrics together.
            return array_map(static function($row){
                if(!is_string($row->metric)||!is_numeric($row->amount)||!is_numeric($row->entries))throw new UnexpectedValueException('Invalid report contract');
                return ['metric'=>$row->metric,'channel'=>$row->channel,'amount'=>(string)$row->amount,'entries'=>(int)$row->entries];
            },$rows);
        });
    }
}
