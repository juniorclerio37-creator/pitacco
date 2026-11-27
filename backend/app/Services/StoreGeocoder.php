<?php
declare(strict_types=1);
namespace App\Services;

use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Store-address lookup only. No database write or automatic public OSM fallback.
 * The caller must first authorize the store, reserve global/per-store quota,
 * and later compare the saved address/marker again under a database lock.
 */
final class StoreGeocoder
{
    public const ENDPOINT = 'https://api.geoapify.com/v1/geocode/search';

    public function lookup(array $store, string $key, ?callable $transport = null): ?array
    {
        if (!app()->environment('testing', 'staging')) {
            throw new RuntimeException('Geocodificação experimental indisponível.');
        }
        if (trim($key) === '') throw new RuntimeException('Provedor de localização não configurado.');
        $query = self::query($store);
        $query['apiKey'] = $key;
        try {
            $payload = $transport
                ? $transport(self::ENDPOINT, $query)
                : Http::acceptJson()->connectTimeout(3)->timeout(8)->withoutRedirecting()
                    ->get(self::ENDPOINT, $query)->throw()->json();
        } catch (\Throwable) {
            // Never surface a provider URL containing credentials.
            throw new RuntimeException('Provedor de localização indisponível.');
        }
        if (!is_array($payload)) throw new RuntimeException('Resposta geográfica inválida.');
        return self::match($store, $payload);
    }

    public static function query(array $store): array
    {
        foreach (['address','city','state'] as $field) {
            if (!is_string($store[$field] ?? null) || trim($store[$field]) === '') {
                throw new RuntimeException('Endereço incompleto.');
            }
        }
        $out = ['street'=>trim($store['address']), 'city'=>trim($store['city']),
            'state'=>trim($store['state']), 'country'=>'Brazil', 'filter'=>'countrycode:br',
            'format'=>'json', 'limit'=>'5'];
        if (trim((string)($store['address_number'] ?? '')) !== '') $out['housenumber'] = trim((string)$store['address_number']);
        $postal = self::postal($store['postal_code'] ?? '');
        if (strlen($postal) === 8) $out['postcode'] = $postal;
        return $out;
    }

    private static function norm(mixed $v): string
    {
        if (!is_string($v)) return '';
        $v = mb_strtolower(trim($v), 'UTF-8');
        return strtr($v, ['á'=>'a','à'=>'a','â'=>'a','ã'=>'a','ä'=>'a','é'=>'e','ê'=>'e',
            'í'=>'i','ó'=>'o','ô'=>'o','õ'=>'o','ú'=>'u','ü'=>'u','ç'=>'c']);
    }
    private static function road(mixed $v): string
    {
        $s = preg_replace('/^(rua|r\.?|avenida|av\.?|travessa|tv\.?)\s+/', '', self::norm($v));
        return trim(preg_replace('/\s+/', ' ', preg_replace('/[^a-z0-9 ]+/', ' ', $s)));
    }
    private static function postal(mixed $v): string
    {
        return is_scalar($v) ? preg_replace('/\D/', '', (string)$v) : '';
    }
    private static function postalMatches(mixed $a, mixed $b): bool
    {
        $a = self::postal($a);
        return strlen($a) === 8 && $a === self::postal($b);
    }
    private static function matchesAny(array $values, string $wanted): bool
    {
        if ($wanted === '') return false;
        foreach ($values as $v) if (self::norm($v) === $wanted) return true;
        return false;
    }
    public static function match(array $store, array $payload): ?array
    {
        self::query($store);
        $city = self::norm($store['city']);
        $district = self::norm($store['neighborhood'] ?? '');
        $number = trim((string)($store['address_number'] ?? ''));
        $road = self::road($store['address']);
        foreach (array_slice(is_array($payload['results'] ?? null) ? $payload['results'] : [],0,5) as $item) {
            if (!is_array($item) || self::norm($item['country_code'] ?? '') !== 'br') continue;
            if (!is_numeric($item['lat'] ?? null) || !is_numeric($item['lon'] ?? null)) continue;
            $lat = (float)$item['lat']; $lng = (float)$item['lon'];
            if (!is_finite($lat) || !is_finite($lng) || $lat < -34 || $lat > 6 || $lng < -75 || $lng > -32) continue;
            if ($road === '' || self::road($item['street'] ?? '') !== $road) continue;
            if (!empty($item['postcode']) && !empty($store['postal_code']) && !self::postalMatches($item['postcode'],$store['postal_code'])) continue;
            if (!self::matchesAny([$item['city']??null,$item['municipality']??null,$item['county']??null],$city)) continue;
            $hasDistrict = self::matchesAny([$item['suburb']??null,$item['district']??null,$item['neighbourhood']??null,$item['city_district']??null],$district);
            if (!$hasDistrict && !self::postalMatches($item['postcode']??'', $store['postal_code']??'')) continue;
            $incoming = trim(is_scalar($item['housenumber']??null)?(string)$item['housenumber']:'');
            if ($incoming !== '' && $incoming !== $number) continue;
            $confidence = $item['rank']['confidence'] ?? null;
            $confidence = is_numeric($confidence) ? (float)$confidence : null;
            if ($confidence !== null && (!is_finite($confidence) || $confidence < .70 || $confidence > 1)) continue;
            $precise = $incoming !== '' && $incoming === $number && in_array(self::norm($item['result_type']??''),['building','amenity','house'],true) && $confidence !== null && $confidence >= .85;
            return ['latitude'=>round($lat,6),'longitude'=>round($lng,6),
                'approximate'=>!$precise,'requires_confirmation'=>!$precise,'provider'=>'geoapify'];
        }
        return null;
    }
}
