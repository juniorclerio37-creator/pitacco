<?php
namespace App\Http\Controllers;
use App\Services\CustomerProfile;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Database\QueryException;
use JsonException;
use UnexpectedValueException;
final class CustomerProfileController
{
    public function session(Request $request,string $slug,CustomerProfile $profile): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.profile_enabled'),404);
        $data=$request->validate(['device'=>['required','uuid'],'action'=>['required','in:resume,logout']]);
        try{
            return response()->json(['data'=>$profile->session($slug,$data)])->header('Cache-Control','no-store');
        } catch(QueryException|JsonException|UnexpectedValueException $e){
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
    }
    public function __invoke(Request $request,string $slug,CustomerProfile $profile): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.profile_enabled'),404);
        $data=$request->validate([
            'phone'=>['required','string','max:30'],
            'device'=>['required','uuid'],
            'action'=>['required','in:load,save'],
            'name'=>['required_if:action,save','prohibited_if:action,load','nullable','string','min:2','max:120'],
            'addresses'=>['prohibited_if:action,load','nullable','array','max:8'],
            'addresses.*'=>['array:id,label,street,number,neighborhood,city,state,postal,extra,is_default'],
            'addresses.*.id'=>['nullable','uuid'],
            'addresses.*.label'=>['nullable','string','max:24'],
            'addresses.*.street'=>['required','string','max:100'],
            'addresses.*.number'=>['required','string','max:20'],
            'addresses.*.neighborhood'=>['required','string','max:60'],
            'addresses.*.city'=>['required','string','max:60'],
            'addresses.*.state'=>['required','string','size:2'],
            'addresses.*.postal'=>['nullable','string','max:9'],
            'addresses.*.extra'=>['nullable','string','max:100'],
            'addresses.*.is_default'=>['sometimes','boolean'],
        ]);
        try {
            $result=$profile->run($slug,$data);
            if(isset($result['error'])) return response()->json(['error'=>'profile_unavailable','session_reset'=>($result['session_reset']??false)===true],409)->header('Cache-Control','no-store');
            return response()->json(['data'=>$result])->header('Cache-Control','no-store');
        } catch(QueryException|JsonException|UnexpectedValueException $e) {
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
    }
}
