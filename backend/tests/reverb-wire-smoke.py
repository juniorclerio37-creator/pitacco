# CI only: real RFC6455 transport, no third-party Python dependency.
import base64,hashlib,json,os,socket,struct,subprocess,time,urllib.request,urllib.error
assert os.environ.get('APP_ENV')=='testing' and os.environ.get('GITHUB_ACTIONS')=='true'
key=os.environ['PITACCO_REALTIME_KEY']
a='20000000-0000-4000-8000-000000000001'
channel='private-pitacco.store.'+a
def api(path,body,expected,token=None):
    h={'Content-Type':'application/json','Accept':'application/json'}
    if token:h['Authorization']='Bearer '+token
    req=urllib.request.Request('http://127.0.0.1:8091/api/v1'+path,data=json.dumps(body).encode(),headers=h,method='POST')
    try:r=urllib.request.urlopen(req,timeout=10)
    except urllib.error.HTTPError as e:r=e
    with r:
        assert r.status==expected,(path,r.status,expected)
        return json.loads(r.read())
class WS:
    def __init__(self):
        for i in range(30):
            try:self.s=socket.create_connection(('127.0.0.1',8092),timeout=1);break
            except OSError:time.sleep(1)
        else:raise AssertionError('Reverb not listening')
        self.s.settimeout(5)
        self.f=self.s.makefile('rb')
        nonce=base64.b64encode(os.urandom(16)).decode()
        req=f'GET /app/{key}?protocol=7&client=js&version=8.4.0 HTTP/1.1\r\nHost: 127.0.0.1:8092\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {nonce}\r\nSec-WebSocket-Version: 13\r\nOrigin: http://pitacco.test\r\n\r\n'
        self.s.sendall(req.encode())
        status=self.f.readline().decode()
        assert ' 101 ' in status,status
        headers={}
        while True:
            line=self.f.readline()
            if line==b'\r\n':break
            assert line
            k,v=line.decode().split(':',1);headers[k.lower()]=v.strip()
        assert headers['sec-websocket-accept']==base64.b64encode(hashlib.sha1((nonce+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
        hello=self.receive()
        assert hello['event']=='pusher:connection_established',hello
        self.id=json.loads(hello['data'])['socket_id']
    def send_frame(self,payload,opcode=1):
        m=os.urandom(4);n=len(payload)
        head=bytes([0x80|opcode,0x80|n]) if n<126 else bytes([0x80|opcode,0xfe])+struct.pack('!H',n)
        self.s.sendall(head+m+bytes(v^m[i%4] for i,v in enumerate(payload)))
    def send(self,data):self.send_frame(json.dumps(data,separators=(',',':')).encode())
    def receive(self):
        while True:
            h=self.f.read(2)
            if not h:raise EOFError('WebSocket closed')
            assert len(h)==2 and h[0]&128 and not h[1]&128
            n=h[1]&127
            if n==126:n=struct.unpack('!H',self.f.read(2))[0]
            elif n==127:n=struct.unpack('!Q',self.f.read(8))[0]
            assert n<=10000
            p=self.f.read(n);op=h[0]&15
            if op==8:raise EOFError('WebSocket closed')
            if op==9:self.send_frame(p,10);continue
            assert op==1
            d=json.loads(p)
            if d['event']=='pusher:ping':self.send({'event':'pusher:pong','data':{}});continue
            return d
    def subscribe(self,auth):self.send({'event':'pusher:subscribe','data':{'channel':channel,'auth':auth}})
    def close(self):self.f.close();self.s.close()
owner=api('/auth/login',{'email':'alice@example.test','password':'fixture-only-password'},200)['access_token']
other=api('/auth/login',{'email':'bob@example.test','password':'fixture-only-password'},200)['access_token']
w=WS();x=WS()
try:
    assert w.id!=x.id
    p={'socket_id':w.id,'channel_name':channel}
    auth=api('/realtime/auth',p,200,owner)['auth']
    api('/realtime/auth',{'socket_id':x.id,'channel_name':channel},404,other)
    w.subscribe(auth)
    subscribed=w.receive()
    assert subscribed['event']=='pusher_internal:subscription_succeeded' and subscribed['channel']==channel,subscribed
    # Replay an authorized signature against another socket; must not subscribe.
    x.subscribe(auth)
    try:
        denied=x.receive()
        assert denied['event']=='pusher:error',denied
    except EOFError:pass
    # Real server-side publish via the installed Pusher SDK; generic invalidation only.
    php="""require 'vendor/autoload.php';
    $p=new Pusher\\Pusher(getenv('PITACCO_REALTIME_KEY'),getenv('PITACCO_REALTIME_SECRET'),'pitacco-core-ci',['host'=>'127.0.0.1','port'=>8092,'scheme'=>'http','useTLS'=>false]);
    $p->trigger('private-pitacco.store.20000000-0000-4000-8000-000000000001','pitacco.invalidate',['resource'=>'orders']);"""
    subprocess.run(['php','-r',php],check=True,timeout=10)
    got=w.receive()
    assert got['event']=='pitacco.invalidate' and got['channel']==channel and json.loads(got['data'])=={'resource':'orders'},got
    x.s.settimeout(1)
    try:
        leaked=x.receive()
        assert leaked['event']!='pitacco.invalidate',leaked
    except (socket.timeout,EOFError):pass
    print('PASS: actual Reverb private subscription, session isolation, signature replay denied and server event delivered')
finally:
    w.close();x.close()
