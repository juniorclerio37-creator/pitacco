<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use Illuminate\Support\Str;
use JsonException;
use UnexpectedValueException;
final class CourierAssignmentsController
{
    public function __invoke(Request $request): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.courier_gps_enabled'),404);
        $data=$request->validate(['p_token'=>['required','string','regex:/\A[a-f0-9]{64}\z/']]);
        if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        try{
            $db=DB::connection('core_courier_gps');
            $items=$db->transaction(function() use($db,$data){
                $db->statement('set transaction read only');
                $db->statement("set local statement_timeout = '3s'");
                $db->statement("set local lock_timeout = '1s'");
                $row=$db->selectOne('select public.pitacco_courier_background_assignments(cast(? as text)) as payload',[$data['p_token']]);
                $items=json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
                if(!is_array($items)||!array_is_list($items)||count($items)>60)throw new UnexpectedValueException('Invalid assignment projection');
                foreach($items as $item){
                    if(!is_array($item)||count($item)!==2||!Str::isUuid($item['id']??'')||!Str::isUuid($item['event_id']??''))throw new UnexpectedValueException('Invalid assignment identifiers');
                }
                return $items;
            });
            return response()->json(['data'=>$items])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $denied=($e->errorInfo[0]??'')==='42501';
            return response()->json(['error'=>$denied?'shift_not_authorized':'temporarily_unavailable'],$denied?403:503)->header('Cache-Control','no-store');
        }catch(JsonException|UnexpectedValueException){
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
    }
}
