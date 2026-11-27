<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
use UnexpectedValueException;
final class PublicMenuReader
{
    public function get(string $slug): ?array
    {
        $db = DB::connection('menu');
        return $db->transaction(function () use ($db,$slug) {
            $db->statement('set transaction read only');
            $db->statement("set local statement_timeout = '3s'");
            $db->statement("set local lock_timeout = '1s'");
            // Explicit, parameterized, allowlisted operation; never expose arbitrary RPC.
            $row = $db->selectOne('select public.get_public_menu(cast(? as text)) as payload', [$slug]);
            if ($row === null || $row->payload === null) return null;
            $menu = json_decode($row->payload, true, 512, JSON_THROW_ON_ERROR);
            if (!is_array($menu) || !isset($menu['store'], $menu['products']) || ($menu['store']['slug'] ?? null) !== $slug || !is_array($menu['products'])) {
                throw new UnexpectedValueException('Invalid public menu contract');
            }
            return $menu;
        });
    }
}
