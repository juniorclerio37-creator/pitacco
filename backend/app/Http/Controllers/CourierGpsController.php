<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
final class CourierGpsController
{
    public function __invoke(Request $request): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.courier_gps_enabled'),404);
        $data=$request->validate([
            'p_token'=>['required','string','regex:/\A[a-f0-9]{64}\z/'],
            'p_lat'=>['required','numeric','between:-90,90'],
            'p_lng'=>['required','numeric','between:-180,180'],
            'p_accuracy_m'=>['required','numeric','between:0,100'],
            'p_motion_state'=>['required_with:p_motion_confidence,p_speed_mps','in:unknown,moving,stopped'],
            'p_motion_confidence'=>['required_with:p_motion_state','integer','between:0,100'],
            'p_speed_mps'=>['nullable','numeric','between:0,80'],
        ]);
        if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        if((float)$data['p_lat']===0.0&&(float)$data['p_lng']===0.0)throw ValidationException::withMessages(['p_lat'=>'Localização inválida.']);
        try{
            $db=DB::connection('core_courier_gps');
            $stamp=$db->transaction(function() use($db,$data){
                $db->statement("set local statement_timeout = '3s'");
                $db->statement("set local lock_timeout = '1s'");
                $args=[$data['p_token'],$data['p_lat'],$data['p_lng'],$data['p_accuracy_m']];
                $base='cast(? as text),cast(? as double precision),cast(? as double precision),cast(? as double precision)';
                if(isset($data['p_motion_state'])){
                    array_push($args,$data['p_motion_state'],$data['p_motion_confidence'],$data['p_speed_mps']??null);
                    $query="select public.pitacco_courier_background_gps_update_motion($base,cast(? as text),cast(? as integer),cast(? as double precision)) as observed_at";
                }else{
                    $query="select public.pitacco_courier_background_gps_update($base) as observed_at";
                }
                return $db->selectOne($query,$args)->observed_at;
            });
            return response()->json(['data'=>['observed_at'=>$stamp]])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $state=$e->errorInfo[0]??'';
            return response()->json(['error'=>match($state){'42501'=>'gps_not_authorized','22023'=>'invalid_location',default=>'temporarily_unavailable'}],match($state){'42501'=>403,'22023'=>422,default=>503})->header('Cache-Control','no-store');
        }
    }
}
