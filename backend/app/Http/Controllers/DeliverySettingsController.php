<?php
namespace App\Http\Controllers;
use App\Services\DeliverySettings;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use JsonException;
use UnexpectedValueException;
final class DeliverySettingsController
{
    private function timeRules(string $prefix): array
    {
        return [
            $prefix.'.min_minutes'=>['required','integer','min:1','max:720'],
            $prefix.'.max_minutes'=>['required','integer','min:1','max:720'],
            $prefix.'.priority'=>['nullable','array:enabled,fee,min_minutes,max_minutes'],
            $prefix.'.priority.enabled'=>['required_with:'.$prefix.'.priority','boolean'],
            $prefix.'.priority.fee'=>['sometimes','numeric','min:0','max:999.99','decimal:0,2'],
            $prefix.'.priority.min_minutes'=>['sometimes','integer','min:1','max:720'],
            $prefix.'.priority.max_minutes'=>['sometimes','integer','min:1','max:720'],
        ];
    }
    private function normalizeTime(array $v): array
    {
        $v['min_minutes']=(int)$v['min_minutes'];
        $v['max_minutes']=(int)$v['max_minutes'];
        if(isset($v['priority'])){
            $p=$v['priority'];
            $p['enabled']=(bool)$p['enabled'];
            if(!$p['enabled'])$p=['enabled'=>false];
            else{
                if(!isset($p['fee'],$p['min_minutes'],$p['max_minutes']))throw ValidationException::withMessages(['priority'=>'Informe taxa e prazos da entrega prioritária.']);
                $p['fee']=(float)$p['fee'];
                $p['min_minutes']=(int)$p['min_minutes'];
                $p['max_minutes']=(int)$p['max_minutes'];
            }
            $v['priority']=$p;
        }
        return $v;
    }
    public function __invoke(Request $request,string $store,DeliverySettings $settings): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.delivery_settings_enabled'),404);
        $data=null;
        if($request->isMethod('PUT')){
            $mode=$request->validate(['mode'=>['required','in:circle,polygons']])['mode'];
            if($mode==='circle'){
                $data=$request->validate([
                    'mode'=>['required','in:circle'],
                    'radius_km'=>['required','integer','min:1','max:10'],
                    'distance_fees'=>['required','array','list','size:10'],
                    'distance_fees.*'=>['required','numeric','min:0','max:999.99','decimal:0,2'],
                    'distance_times'=>['required','array','list','size:10'],
                    'distance_times.*'=>['required','array:min_minutes,max_minutes,priority'],
                ]+$this->timeRules('distance_times.*'));
                $data['distance_fees']=array_map('floatval',$data['distance_fees']);
                $data['distance_times']=array_map(fn($v)=>$this->normalizeTime($v),$data['distance_times']);
            }else{
                $data=$request->validate([
                    'mode'=>['required','in:polygons'],
                    'polygons'=>['required','array','list','min:1','max:12'],
                    'polygons.*'=>['required','array:id,name,vertices,fee,min_minutes,max_minutes,priority'],
                    'polygons.*.id'=>['sometimes','string','min:1','max:100','distinct:strict'],
                    'polygons.*.name'=>['required','string','min:1','max:60'],
                    'polygons.*.vertices'=>['required','array','list','min:3','max:30'],
                    'polygons.*.vertices.*'=>['required','array','list','size:2'],
                    'polygons.*.vertices.*.0'=>['required','numeric','between:-34,6'],
                    'polygons.*.vertices.*.1'=>['required','numeric','between:-75,-32'],
                    'polygons.*.fee'=>['required','numeric','min:0','max:999.99','decimal:0,2'],
                ]+$this->timeRules('polygons.*'));
                foreach($data['polygons'] as &$p){
                    $p['fee']=(float)$p['fee'];
                    $p['vertices']=array_map(fn($v)=>array_map('floatval',$v),$p['vertices']);
                    $p=$this->normalizeTime($p);
                }
                unset($p);
            }
            if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
        }
        try{return response()->json(['data'=>$settings->run($request->attributes->get('core_session'),$store,$data)])->header('Cache-Control','no-store');}
        catch(QueryException $e){
            $s=$e->errorInfo[0]??'';
            return response()->json(['error'=>match($s){'42501'=>'forbidden','P0001','22023'=>'operation_not_allowed',default=>'temporarily_unavailable'}],match($s){'42501'=>403,'P0001','22023'=>409,default=>503})->header('Cache-Control','no-store');
        }catch(JsonException|UnexpectedValueException){return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');}
    }
}
