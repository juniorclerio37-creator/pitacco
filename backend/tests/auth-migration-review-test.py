import pathlib,sys,unittest,copy
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from auth_migration_review import reconcile
def u(n):return '10000000-0000-4000-8000-'+str(n).zfill(12)
def s(n):return '20000000-0000-4000-8000-'+str(n).zfill(12)
def user(n,role='lojista',**extra):
 return dict(id=u(n),verified=True,disabled=False,credential_kind='bcrypt',profile_role=role,email_unique=True)|extra
def fixture():
 return {'users':[user(1,'gestor'),user(2),user(3,'admin'),user(4,'entregador'),user(5,verified=False)],
 'stores':[{'id':s(1),'active':True},{'id':s(2),'active':True}],
 'memberships':[{'user_id':u(1),'store_id':s(1),'role':'gestor'},{'user_id':u(2),'store_id':s(2),'role':'lojista'},{'user_id':u(5),'store_id':s(1),'role':'gestor'}],
 'couriers':[{'id':u(9),'user_id':u(4),'store_id':s(1),'active':True,'fleet_type':'propria','must_change_password':False}],
 'platform_owners':[u(3)],'pending_invite_count':1}
class TestReview(unittest.TestCase):
 def test_scope_and_roles(self):
  result=reconcile(fixture())
  self.assertFalse(result['apply_allowed'])
  self.assertEqual({(x['user_id'],x['store_id'],x['role']) for x in result['candidates']},{(u(1),s(1),'manager'),(u(2),s(2),'operator'),(u(4),s(1),'courier')})
  self.assertEqual({i['code'] for i in result['issues']},{'separate_control_center_authorization','credential_or_identity_review','pending_invites_not_memberships'})
 def test_conflict(self):
  data=fixture();data['memberships'].append({'user_id':u(4),'store_id':s(1),'role':'gestor'})
  result=reconcile(data)
  self.assertNotIn(u(4),[x['user_id'] for x in result['candidates']])
 def test_unknown_or_orphan(self):
  data=fixture();data['memberships'][0]['role']='owner'
  self.assertNotIn(u(1),[x['user_id'] for x in reconcile(data)['candidates']])
  data['memberships'][0]['store_id']=s(9)
  with self.assertRaises(ValueError):reconcile(data)
 def test_secret_fields_rejected(self):
  data=fixture();data['users'][0]['password_hash']='not-a-real-hash'
  with self.assertRaises(ValueError):reconcile(data)
 def test_disabled_store_and_courier_reset(self):
  data=fixture();data['stores'][1]['active']=False;data['couriers'][0]['must_change_password']=True
  self.assertEqual([x['user_id'] for x in reconcile(data)['candidates']],[u(1)])
if __name__=='__main__':unittest.main()
