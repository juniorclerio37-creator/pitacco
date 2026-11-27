<?php
declare(strict_types=1);
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use App\Services\StoreGeocoder;
function check(bool $ok,string $msg):void {if(!$ok)throw new RuntimeException($msg);}
$store=['address'=>'Rua São José','address_number'=>'10','city'=>'Nova Iguaçu','state'=>'RJ','neighborhood'=>'Centro','postal_code'=>'26000-000'];
$item=['country_code'=>'br','lat'=>-22.8512345,'lon'=>-43.4512345,'street'=>'São José','city'=>'Nova Iguacu','suburb'=>'Centro','postcode'=>'26000000','housenumber'=>'10','result_type'=>'building','rank'=>['confidence'=>.91]];
$geo=new StoreGeocoder;
$seen=0;
$point=$geo->lookup($store,'fixture-key',function($url,$query)use(&$seen,$item){
 $seen++;
 check($url===StoreGeocoder::ENDPOINT,'Unexpected endpoint');
 check($query['street']==='Rua São José'&&$query['housenumber']==='10'&&$query['postcode']==='26000000'&&$query['filter']==='countrycode:br','Incorrect saved address');
 check($query['apiKey']==='fixture-key','Missing server credential');
 return ['results'=>[$item]];
});
check($seen===1&&$point===['latitude'=>-22.851235,'longitude'=>-43.451235,'approximate'=>false,'requires_confirmation'=>false,'provider'=>'geoapify'],'Precise point');
foreach ([['country_code'=>'us'],['city'=>'Outro município'],['street'=>'Outra rua'],['housenumber'=>'11'],['postcode'=>'12345678'],['lat'=>80],['rank'=>['confidence'=>.69]],['suburb'=>'Outro bairro','postcode'=>null]] as $bad) {
 check(StoreGeocoder::match($store,['results'=>[array_replace($item,$bad)]])===null,'Unsafe match: '.json_encode($bad));
}
foreach ([['housenumber'=>'','result_type'=>'street'],['rank'=>['confidence'=>.80]],['rank'=>[]]] as $approx) {
 $p=StoreGeocoder::match($store,['results'=>[array_replace($item,$approx)]]);
 check($p['approximate']===true&&$p['requires_confirmation']===true,'Approximate confirmation');
}
try{$geo->lookup($store,'fixture-key',fn()=>throw new RuntimeException('fixture-key private URL'));throw new LogicException('Expected failure');}
catch(RuntimeException $e){check($e->getMessage()==='Provedor de localização indisponível.','Secret leaked');}
check(StoreGeocoder::match($store,['results'=>[]])===null,'Empty result');
echo "PASS: Geoapify store matching, approximate confirmation, mocked transport and secret protection\n";
