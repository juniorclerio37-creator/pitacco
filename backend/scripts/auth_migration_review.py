"""Offline, metadata-only identity reconciliation. No database or network access.
The output is a review plan, NOT an importer or an authorization decision.
Never supply passwords, hashes, tokens, real emails or full user records.
"""
import argparse
import json
import uuid
from collections import Counter

def uid(value):
    if not isinstance(value,str):
        raise ValueError('Invalid identifier')
    result=str(uuid.UUID(value))
    if result!=value:
        raise ValueError('Noncanonical identifier')
    return result

def index(rows, allowed, label):
    result={}
    for row in rows:
        if not isinstance(row,dict) or set(row)!=allowed:
            raise ValueError('Unexpected metadata fields: '+label)
        key=uid(row['id'])
        if key in result:
            raise ValueError('Duplicate identifier: '+label)
        result[key]=row
    return result

def reconcile(data):
    if not isinstance(data,dict) or set(data)!={'users','stores','memberships','couriers','platform_owners','pending_invite_count'}:
        raise ValueError('Unexpected manifest fields')
    users=index(data['users'],{'id','verified','disabled','credential_kind','profile_role','email_unique'},'users')
    stores=index(data['stores'],{'id','active'},'stores')
    couriers=index(data['couriers'],{'id','user_id','store_id','active','fleet_type','must_change_password'},'couriers')
    for u in users.values():
        if not all(type(u[k]) is bool for k in ['verified','disabled','email_unique']):
            raise ValueError('Invalid account flags')
        if u['credential_kind'] not in ['bcrypt','other','none'] or u['profile_role'] not in ['admin','gestor','lojista','entregador','unknown']:
            raise ValueError('Unrecognized account metadata')
    if any(type(s['active']) is not bool for s in stores.values()):
        raise ValueError('Invalid store flags')
    owners=set()
    for value in data['platform_owners']:
        k=uid(value)
        if k not in users or k in owners:raise ValueError('Invalid platform owner')
        owners.add(k)
    issues=[]; links={}; courier_ids=set(); courier_users=set()
    def issue(code,user=None,store=None):
        issues.append({'code':code,'user_id':user,'store_id':store})
    def link(user,store,role):
        if user not in users or store not in stores:raise ValueError('Orphan relationship')
        k=(user,store)
        if k in links:
            issue('duplicate_or_conflicting_membership',user,store)
            links[k]=None
        else:links[k]=role
    for m in data['memberships']:
        if set(m)!={'user_id','store_id','role'}:raise ValueError('Unexpected membership fields')
        user,store=uid(m['user_id']),uid(m['store_id'])
        if m['role'] not in ('gestor','lojista'):
            issue('unknown_merchant_role',user,store)
            link(user,store,None)
        else:link(user,store,{'gestor':'manager','lojista':'operator'}[m['role']])
    for cid,c in couriers.items():
        user,store=uid(c['user_id']),uid(c['store_id'])
        if user not in users or store not in stores:raise ValueError('Orphan courier')
        if type(c['active']) is not bool or type(c['must_change_password']) is not bool:raise ValueError('Invalid courier flags')
        if not c['active']:continue
        if c['fleet_type']!='propria' or c['must_change_password'] or users[user]['profile_role']!='entregador':
            issue('courier_requires_review',user,store)
            continue
        if user in courier_users:issue('multiple_active_couriers',user,store)
        courier_users.add(user);courier_ids.add(cid);link(user,store,'courier')
    for u,v in users.items():
        if v['disabled'] or not v['verified'] or not v['email_unique'] or v['credential_kind']!='bcrypt':
            issue('credential_or_identity_review',u)
        if v['profile_role']=='admin' or u in owners:issue('separate_control_center_authorization',u)
    if type(data['pending_invite_count']) is not int or data['pending_invite_count']<0:raise ValueError('Invalid invite count')
    if data['pending_invite_count']:issue('pending_invites_not_memberships')
    blocked_users={i['user_id'] for i in issues if i['user_id'] is not None}
    candidates=[]
    for (user,store),role in sorted(links.items()):
        if role is not None and user not in blocked_users and stores[store]['active']:
            candidates.append({'user_id':user,'store_id':store,'role':role,'status':'review_only'})
    return {'mode':'metadata_review_only','apply_allowed':False,'counts':{'users':len(users),'stores':len(stores),'legacy_memberships':len(data['memberships']),'courier_records':len(couriers),'candidate_roles':dict(Counter(x['role'] for x in candidates)),'pending_invites':data['pending_invite_count']},'candidates':candidates,'issues':issues}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest')
    args=parser.parse_args()
    with open(args.manifest,encoding='utf-8') as f:
        print(json.dumps(reconcile(json.load(f)),ensure_ascii=False,indent=2))
