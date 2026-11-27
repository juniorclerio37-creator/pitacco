<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\QueryException;
final class OwnBoardLogisticsController
{
    public function __invoke(Request $request,string $store,string $resource): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.own_logistics_enabled'),404);
        $data=$request->validate(['limit'=>['sometimes','integer','min:1','max:100'],'offset'=>['sometimes','integer','min:0','max:10000']]);
        $limit=(int)($data['limit']??50);$offset=(int)($data['offset']??0);
        $session=$request->attributes->get('core_session');
        try {
            $db=DB::connection('core_own_logistics');
            $rows=$db->transaction(function()use($db,$session,$store,$resource,$limit,$offset){
                $db->statement('set transaction read only');
                $db->statement("set local statement_timeout = '3s'");
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed===true,404);
                $row=$db->selectOne('select core_auth.own_logistics_fixture(cast(? as uuid),cast(? as text),cast(? as integer),cast(? as integer)) as rows',[$store,$resource,$limit,$offset]);
                return json_decode($row->rows,true,512,JSON_THROW_ON_ERROR);
            });
            return response()->json(['data'=>$rows,'limit'=>$limit,'offset'=>$offset])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            return response()->json(['error'=>'temporarily_unavailable'],503)->header('Cache-Control','no-store');
        }
    }

    public function point(Request $request,string $store): JsonResponse
    {
        return $this->mapResponse($request,$store,false);
    }
    public function fleet(Request $request,string $store): JsonResponse
    {
        return $this->mapResponse($request,$store,true);
    }
    private function mapResponse(Request $request,string $store,bool $fleet): JsonResponse
    {
        abort_unless(app()->environment('testing') && config('pitacco.own_logistics_enabled'),404);
        $write=$request->isMethod('PUT');
        $rules=$write?['latitude'=>['required','numeric','between:-34,6'],'longitude'=>['required','numeric','between:-75,-32'],'confirmed'=>['required','boolean']]:[];
        $data=$request->validate($rules);
        if($request->query()||array_diff(array_keys($request->all()),array_keys($rules))||($write&&($data['confirmed']!==true||!is_int($data['latitude'])&&!is_float($data['latitude'])||!is_int($data['longitude'])&&!is_float($data['longitude']))))throw \Illuminate\Validation\ValidationException::withMessages(['request'=>'Confirme o ponto da loja no mapa.']);
        $session=$request->attributes->get('core_session');
        try{
            $db=DB::connection('core_own_logistics');
            $result=$db->transaction(function()use($db,$session,$store,$fleet,$write,$data){
                if(!$write)$db->statement('set transaction read only');
                $db->statement("set local statement_timeout = '5s'");
                $db->statement("set local lock_timeout = '2s'");
                $db->selectOne("select set_config('request.jwt.claim.sub',?,true),set_config('pitacco.core_session_id',?,true),set_config('request.jwt.claims',?,true)",[$session->user_id,$session->session_id,json_encode(['sub'=>$session->user_id,'role'=>'authenticated'],JSON_THROW_ON_ERROR)]);
                abort_unless($db->selectOne('select core_auth.can_act(cast(? as uuid)) as allowed',[$store])?->allowed===true,404);
                $row=$fleet?$db->selectOne('select core_auth.fleet_map_fixture(cast(? as uuid)) as payload',[$store]):$db->selectOne('select core_auth.store_point_fixture(cast(? as uuid),cast(? as numeric),cast(? as numeric)) as payload',[$store,$write?$data['latitude']:null,$write?$data['longitude']:null]);
                return json_decode($row->payload,true,512,JSON_THROW_ON_ERROR);
            });
            return response()->json(['data'=>$result])->header('Cache-Control','no-store');
        }catch(QueryException $e){
            $s=$e->errorInfo[0]??'';
            return response()->json(['error'=>match($s){'42501'=>'not_authorized','22023'=>'invalid_store_point','P0001'=>'point_limit',default=>'temporarily_unavailable'}],match($s){'42501'=>404,'22023'=>422,'P0001'=>429,default=>503})->header('Cache-Control','no-store');
        }
    }
}
