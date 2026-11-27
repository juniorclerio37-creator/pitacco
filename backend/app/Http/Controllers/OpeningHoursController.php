<?php
namespace App\Http\Controllers;
use App\Services\OpeningHours;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
use Illuminate\Validation\ValidationException;
use JsonException;
use UnexpectedValueException;
final class OpeningHoursController
{
    public function __invoke(Request $request,string $store,OpeningHours $hours): JsonResponse
    {
        abort_unless(app()->environment('testing')&&config('pitacco.opening_hours_enabled'),404);
        $data=null;
        if($request->isMethod('PUT')){
            $data=$request->validate([
                'periods'=>['present','array','list','max:21'],
                'periods.*'=>['required','array:weekday,slot,opens_minute,closes_minute'],
                'periods.*.weekday'=>['required','integer','between:1,7'],
                'periods.*.slot'=>['required','integer','between:1,3'],
                'periods.*.opens_minute'=>['required','integer','between:0,1439'],
                'periods.*.closes_minute'=>['required','integer','between:0,1440'],
                'paused'=>['required','boolean'],
                'accepts_scheduled'=>['required','boolean'],
                'expected_revision'=>['required','integer','min:0','max:2147483646'],
            ]);
            if(array_diff(array_keys($request->all()),array_keys($data)))throw ValidationException::withMessages(['request'=>'Campos não suportados.']);
            $seen=[];
            foreach($data['periods'] as &$p){
                $p=array_map('intval',$p);
                $key=$p['weekday'].':'.$p['slot'];
                if(isset($seen[$key])||$p['opens_minute']===$p['closes_minute'])throw ValidationException::withMessages(['periods'=>'Período duplicado ou inválido.']);
                $seen[$key]=true;
            }
            unset($p);
            $data['paused']=(bool)$data['paused'];
            $data['accepts_scheduled']=(bool)$data['accepts_scheduled'];
        }
        try{return response()->json(['data'=>$hours->run($request->attributes->get('core_session'),$store,$data)])->header('Cache-Control','no-store');}
        catch(QueryException $e){
            $s=$e->errorInfo[0]??'';
            return response()->json(['error'=>match($s){'42501'=>'forbidden','P0001','22023'=>'operation_not_allowed',default=>'temporarily_unavailable'}],match($s){'42501'=>403,'P0001','22023'=>409,default=>503})->header('Cache-Control','no-store');
        }catch(JsonException|UnexpectedValueException){return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');}
    }
}
