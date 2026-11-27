<?php
namespace App\Services;
use Illuminate\Support\Facades\DB;
final class CoreSessions
{
    private function db() { return DB::connection('core_auth'); }
    public function login(string $email,string $password): ?array
    {
        $db=$this->db();
        $user=$db->selectOne('select id,email,password_hash,active from core_auth.users where email=?',[strtolower(trim($email))]);
        // Verify a dummy hash even for absent identities; never return different login errors.
        $valid=LegacyBcrypt::verify($password,$user?->password_hash);
        if (!$valid || !$user || !$user->active) return null;
        $token=bin2hex(random_bytes(32));
        // Recheck the exact credential and account status at issuance.
        $session=$db->selectOne("insert into core_auth.sessions(user_id,token_hash,expires_at)
          select id, ?, now()+interval '1 hour' from core_auth.users where id=? and active and password_hash=?
          returning expires_at",[hash('sha256',$token),$user->id,$user->password_hash]);
        return $session ? ['access_token'=>$token,'token_type'=>'Bearer','expires_at'=>$session->expires_at] : null;
    }
    public function find(?string $token): ?object
    {
        if (!$token || !preg_match('/\A[a-f0-9]{64}\z/D',$token)) return null;
        return $this->db()->selectOne('select s.id as session_id,u.id as user_id,u.email from core_auth.sessions s join core_auth.users u on u.id=s.user_id where s.token_hash=? and s.revoked_at is null and s.expires_at>now() and u.active',[hash('sha256',$token)]);
    }
    // Rotate the active bearer in place. No refresh secret, no resurrection,
    // no change to session_id (native GPS/print bindings stay scoped).
    public function renew(object $session,string $previous): ?array
    {
        if (!preg_match('/\A[a-f0-9]{64}\z/D',$previous)) return null;
        $token=bin2hex(random_bytes(32));
        $row=$this->db()->selectOne("update core_auth.sessions s
          set token_hash=?, expires_at=least(now()+interval '1 hour',s.created_at+interval '8 hours')
          where s.id=? and s.user_id=? and s.token_hash=? and s.revoked_at is null
          and s.expires_at>now() and s.created_at+interval '8 hours'>now()+interval '1 minute'
          and s.expires_at<=now()+interval '15 minutes'
          and exists(select 1 from core_auth.users u where u.id=s.user_id and u.active)
          returning expires_at", [hash('sha256',$token),$session->session_id,$session->user_id,hash('sha256',$previous)]);
        return $row ? ['access_token'=>$token,'token_type'=>'Bearer','expires_at'=>$row->expires_at] : null;
    }

    public function revoke(object $session): void
    {
        $this->db()->update('update core_auth.sessions set revoked_at=now() where id=? and user_id=? and revoked_at is null',[$session->session_id,$session->user_id]);
    }
    public function memberships(object $session): array
    {
        return $this->db()->select('select s.id as store_id,s.name,m.role from core_auth.memberships m join core_auth.stores s on s.id=m.store_id join core_auth.users u on u.id=m.user_id where m.user_id=? and m.active and s.active and u.active order by s.id',[$session->user_id]);
    }
    public function store(object $session,string $id): ?object
    {
        return $this->db()->selectOne('select s.id as store_id,s.name,m.role from core_auth.memberships m join core_auth.stores s on s.id=m.store_id join core_auth.users u on u.id=m.user_id where m.user_id=? and m.store_id=? and m.active and s.active and u.active',[$session->user_id,$id]);
    }
}
