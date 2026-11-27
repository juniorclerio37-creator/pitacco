<?php
declare(strict_types=1);
namespace App\Services;

/** Narrow compatibility verifier for the experimental Core identity store.
 * Never accept plaintext, arbitrary algorithms, malformed hashes or overlong input.
 * Existing credentials outside the supported range require a separate review.
 */
final class LegacyBcrypt
{
    private const DUMMY = '$2y$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

    public static function supported(?string $hash): bool
    {
        return $hash !== null
            && preg_match('/\A\$2[aby]\$(?:0[4-9]|1[0-4])\$[.\/A-Za-z0-9]{53}\z/D', $hash) === 1;
    }

    public static function verify(string $password, ?string $hash): bool
    {
        $eligible = self::supported($hash) && strlen($password) <= 72
            && $password !== '' && !str_contains($password, "\0");
        // Execute a dummy bcrypt verification even when an identity or hash is absent.
        $valid = password_verify($eligible ? $password : 'invalid-fixture-input',
            $eligible ? $hash : self::DUMMY);
        return $eligible && $valid;
    }
}
