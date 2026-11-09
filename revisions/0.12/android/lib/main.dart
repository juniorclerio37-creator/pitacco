import 'dart:async';
import 'dart:math' as math;
import 'package:geolocator/geolocator.dart';
import 'package:geocoding/geocoding.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:url_launcher/url_launcher.dart';

const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');

@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (supabaseUrl.isEmpty || supabaseAnonKey.isEmpty) {
    runApp(const MaterialApp(home: Scaffold(body: Center(child: Text('Configure SUPABASE_URL e SUPABASE_ANON_KEY no build.')))));
    return;
  }
  await Supabase.initialize(url: supabaseUrl, anonKey: supabaseAnonKey);
  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);
  } catch (e) {
    debugPrint('Firebase indisponível: $e');
  }
  runApp(const DeliveryGestorApp());
}

final api = Supabase.instance.client;

class DeliveryGestorApp extends StatelessWidget {
  const DeliveryGestorApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Pitacco Entregador', debugShowCheckedModeBanner: false,
    theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF176DAD)), useMaterial3: true),
    home: const AuthGate(),
  );
}

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});
  @override
  State<AuthGate> createState() => _AuthGateState();
}
class _AuthGateState extends State<AuthGate> {
  late final StreamSubscription<AuthState> sub;
  @override
  void initState() {
    super.initState();
    sub = api.auth.onAuthStateChange.listen((_) { if (mounted) setState(() {}); });
  }
  @override
  void dispose() { sub.cancel(); super.dispose(); }
  @override
  Widget build(BuildContext context) => api.auth.currentUser == null ? const LoginPage() : const CourierPage();
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginPageState();
}
class _LoginPageState extends State<LoginPage> {
  final email = TextEditingController(), password = TextEditingController();
  bool busy = false;
  String? error;
  Future<void> submit({required bool signUp}) async {
    setState(() { busy = true; error = null; });
    try {
      if (signUp) {
        await api.auth.signUp(email: email.text.trim(), password: password.text);
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Cadastro solicitado. Confirme o e-mail e peça o vínculo ao restaurante.')));
      } else {
        await api.auth.signInWithPassword(email: email.text.trim(), password: password.text);
      }
    } catch (e) { setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override
  void dispose() { email.dispose(); password.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Pitacco • Entregador')),
    body: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 420), child: Padding(
      padding: const EdgeInsets.all(20), child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.delivery_dining, size: 70), const SizedBox(height: 18),
        TextField(controller: email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'E-mail')),
        TextField(controller: password, obscureText: true, decoration: const InputDecoration(labelText: 'Senha')),
        if (error != null) Padding(padding: const EdgeInsets.all(8), child: Text(error!, style: const TextStyle(color: Colors.red))),
        const SizedBox(height: 20),
        FilledButton(onPressed: busy ? null : () => submit(signUp: false), child: const Text('Entrar')),
        TextButton(onPressed: busy ? null : () => submit(signUp: true), child: const Text('Criar conta')),
      ]),
    ))),
  );
}

class CourierPage extends StatefulWidget {
  const CourierPage({super.key});
  @override
  State<CourierPage> createState() => _CourierPageState();
}
class _CourierPageState extends State<CourierPage> {
  Map<String, dynamic>? courier;
  List<Map<String, dynamic>> deliveries = [];
  String? error;
  bool loading = true, updating = false, routing = false;
  List<Map<String, dynamic>> optimized = [];
  String? routeInfo;
  RealtimeChannel? channel;
  StreamSubscription<String>? tokenSub;
  Timer? refreshTimer;
  Timer? gpsTimer;
  bool sendingPosition = false;

  @override
  void initState() { super.initState(); load(); }
  Future<void> setupNotifications() async {
    try {
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission();
      final token = await messaging.getToken();
      if (token != null) await saveToken(token);
      tokenSub ??= messaging.onTokenRefresh.listen(saveToken);
    } catch (e) { debugPrint('Push não configurado: $e'); }
  }
  Future<void> saveToken(String token) async {
    if (courier == null) return;
    try { await api.from('courier_device_tokens').upsert({
      'courier_id': courier!['id'], 'user_id': api.auth.currentUser!.id,
      'token': token, 'platform': 'android', 'updated_at': DateTime.now().toUtc().toIso8601String(),
    }, onConflict: 'token'); } catch (e) { debugPrint('Token: $e'); }
  }
  Future<void> load() async {
    if (!mounted) return;
    setState(() { loading = true; error = null; });
    try {
      final me = await api.from('couriers').select('id,name,fleet_type,active,available').eq('user_id', api.auth.currentUser!.id).maybeSingle();
      if (me == null || me['active'] != true) {
        courier = null; deliveries = [];
        error = 'Sua conta ainda não foi vinculada como entregador ativo. Solicite o cadastro ao restaurante ou administrador.';
      } else {
        courier = me;
        await refreshDeliveries();
        channel ??= api.channel('courier-deliveries-${me['id']}')
          ..onPostgresChanges(event: PostgresChangeEvent.all, schema: 'public', table: 'deliveries', callback: (_) => refreshDeliveries())
          .subscribe();
        refreshTimer ??= Timer.periodic(const Duration(seconds: 30), (_) => refreshDeliveries());
        await setupNotifications();
        gpsTimer ??= Timer.periodic(const Duration(seconds: 30), (_) => sendPosition());
        if (me['available'] == true) await sendPosition();
      }
    } catch (e) { error = e.toString(); }
    if (mounted) setState(() => loading = false);
  }
  Future<void> refreshDeliveries() async {
    if (courier == null) return;
    try {
      final rows = await api.from('deliveries')
        .select('id,customer_name,address,notes,status,courier_payment,created_at,source,requires_delivery_code,delivery_code_verified_at,batch_id,collected_at')
        .eq('courier_id', courier!['id']).order('created_at', ascending: false).limit(100);
      if (mounted) setState(() => deliveries = List<Map<String, dynamic>>.from(rows));
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
  }
  Future<void> setAvailable(bool value) async {
    try {
      await api.rpc('set_courier_availability', params: {'is_available': value});
      if (mounted) setState(() => courier!['available'] = value);
      if (value) await sendPosition();
    } catch (e) { showError(e); }
  }
  Future<void> sendPosition() async {
    if (sendingPosition || courier?['available'] != true) return;
    sendingPosition = true;
    try {
      if (!await Geolocator.isLocationServiceEnabled()) throw Exception('Ative o GPS para receber alocações automáticas.');
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) throw Exception('Localização não autorizada. Alocação automática indisponível.');
      final position = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)));
      await api.rpc('courier_heartbeat', params: {'lat': position.latitude, 'lng': position.longitude, 'accuracy': position.accuracy});
    } catch (e) { if (mounted) setState(() => error = 'GPS: $e'); }
    finally { sendingPosition = false; }
  }
  Future<void> collect(String id) async {
    setState(() => updating = true);
    try { await api.rpc('collect_delivery', params: {'p_delivery': id}); await refreshDeliveries(); }
    catch (e) { showError(e); }
    finally { if (mounted) setState(() => updating = false); }
  }
  Future<void> depart(String route) async {
    final yes = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
      title: const Text('Sair da loja?'), content: const Text('A rota será fechada para novos pedidos. Confira se coletou todas as paradas.'),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Voltar')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Confirmar saída'))]));
    if (yes != true || !mounted) return;
    setState(() => updating = true);
    try { await api.rpc('depart_route', params: {'p_route': route}); await refreshDeliveries(); }
    catch (e) { showError(e); }
    finally { if (mounted) setState(() => updating = false); }
  }
  Future<void> changeStatus(String id, String status) async {
    setState(() => updating = true);
    try {
      await api.rpc('set_delivery_status', params: {'d': id, 'next_status': status});
      await refreshDeliveries();
    } catch (e) { showError(e); }
    finally { if (mounted) setState(() => updating = false); }
  }
  // Heurística de vizinho mais próximo usando distância geográfica aproximada.
  // NÃO considera trânsito ou restrições de circulação. Google Maps faz navegação.
  double distanceKm(double lat1, double lon1, double lat2, double lon2) {
    const r = 6371.0;
    final a = math.pow(math.sin((lat2-lat1)*math.pi/360),2) +
      math.cos(lat1*math.pi/180)*math.cos(lat2*math.pi/180)*
      math.pow(math.sin((lon2-lon1)*math.pi/360),2);
    return 2*r*math.asin(math.sqrt(a.toDouble()));
  }
  Future<void> optimizeRoute() async {
    final pending = deliveries.where((d) => ['aceita','retirada'].contains(d['status'])).toList();
    if (pending.length < 2) { showError('É preciso ter ao menos duas entregas aceitas ou retiradas.'); return; }
    setState(() { routing = true; routeInfo = null; });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) throw Exception('Ative a localização do aparelho.');
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) throw Exception('Permita o acesso à localização.');
      final position = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high));
      final candidates = <Map<String,dynamic>>[];
      for (final d in pending) {
        final matches = await locationFromAddress('${d['address']}, Brasil');
        if (matches.isEmpty) throw Exception('Endereço não localizado: ${d['address']}');
        candidates.add({...d, '_lat':matches.first.latitude, '_lon':matches.first.longitude});
      }
      var lat = position.latitude, lon = position.longitude;
      final ordered = <Map<String,dynamic>>[];
      var km = 0.0;
      while (candidates.isNotEmpty) {
        candidates.sort((a,b) => distanceKm(lat,lon,a['_lat'],a['_lon']).compareTo(distanceKm(lat,lon,b['_lat'],b['_lon'])));
        final next = candidates.removeAt(0);
        km += distanceKm(lat,lon,next['_lat'],next['_lon']);
        ordered.add(next);
        lat = next['_lat']; lon = next['_lon'];
      }
      if (mounted) setState(() { optimized = ordered; routeInfo = 'Ordem sugerida por proximidade (~${km.toStringAsFixed(1)} km em linha reta). Não considera trânsito, prazos ou regras do marketplace.'; });
    } catch (e) { showError(e); }
    finally { if (mounted) setState(() => routing = false); }
  }
  Future<void> openOptimizedRoute() async {
    if (optimized.isEmpty) return;
    // Navegação multi-parada no Google Maps: intermediários + destino final.
    final stops = optimized.map((d) => '${d['_lat']},${d['_lon']}').toList();
    final destination = stops.removeLast();
    final url = Uri.https('www.google.com','/maps/dir/',{
      'api':'1','destination':destination,'travelmode':'driving',
      if (stops.isNotEmpty) 'waypoints':stops.join('|'),
    });
    if (!await launchUrl(url, mode: LaunchMode.externalApplication)) showError('Não foi possível abrir o Google Maps.');
  }
  Future<void> requestDeliveryCode(Map<String,dynamic> d) async {
    final controller = TextEditingController();
    final code = await showDialog<String>(context:context,builder:(context) => AlertDialog(
      title: const Text('Código de confirmação'),
      content: Column(mainAxisSize:MainAxisSize.min,children:[
        const Text('Solicite o código ao cliente. A confirmação oficial depende da integração homologada.'),
        TextField(controller:controller, keyboardType:TextInputType.number, obscureText:true, decoration:const InputDecoration(labelText:'Código de entrega')),
      ]),
      actions:[TextButton(onPressed:()=>Navigator.pop(context),child:const Text('Cancelar')),
        FilledButton(onPressed:()=>Navigator.pop(context,controller.text.trim()),child:const Text('Verificar'))],
    ));
    controller.dispose();
    if (code == null || code.isEmpty) return;
    setState(()=>updating=true);
    try {
      // Endpoint protegido: deve validar código junto à API oficial, não apenas compará-lo no app.
      final response = await api.functions.invoke('verify-marketplace-delivery',body:{'delivery_id':d['id'],'code':code});
      if (response.status != 200 || response.data is! Map || response.data['verified'] != true) {
        throw Exception('Código não confirmado pela plataforma. Entrega permanece pendente.');
      }
      await refreshDeliveries();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Código confirmado. Agora finalize a entrega.')));
    } catch(e) { showError(e); }
    finally { if (mounted) setState(()=>updating=false); }
  }
  void showError(Object e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  Future<void> openMap(String address) async {
    final url = Uri.parse('https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(address)}');
    if (!await launchUrl(url, mode: LaunchMode.externalApplication)) showError('Não foi possível abrir o mapa.');
  }
  @override
  void dispose() { refreshTimer?.cancel(); gpsTimer?.cancel(); tokenSub?.cancel(); if (channel != null) api.removeChannel(channel!); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final total = deliveries.where((d) => d['status'] == 'entregue').fold<double>(0, (sum, d) => sum + (num.tryParse('${d['courier_payment']}')?.toDouble() ?? 0));
    return Scaffold(appBar: AppBar(title: const Text('Minhas entregas'), actions: [
      IconButton(onPressed: load, icon: const Icon(Icons.refresh), tooltip: 'Atualizar'),
      IconButton(onPressed: () async { await setAvailable(false); await api.auth.signOut(); }, icon: const Icon(Icons.logout), tooltip: 'Sair'),
    ]), body: loading ? const Center(child: CircularProgressIndicator()) : RefreshIndicator(
      onRefresh: refreshDeliveries, child: ListView(padding: const EdgeInsets.all(16), children: [
        if (error != null) Card(child: Padding(padding: const EdgeInsets.all(16), child: Text(error!))),
        if (courier != null) ...[
          Text('Olá, ${courier!['name']}', style: Theme.of(context).textTheme.titleLarge),
          SwitchListTile(title: const Text('Online para receber pedidos'), value: courier!['available'] == true, onChanged: setAvailable),
          Card(child: ListTile(title: const Text('Ganhos das entregas concluídas (últimas 100)'), subtitle: Text('R\$ ${total.toStringAsFixed(2).replaceAll('.', ',')}'))),
          const SizedBox(height: 12),
          Card(child: Padding(padding:const EdgeInsets.all(12),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
            const Text('Roteirização de múltiplas entregas',style:TextStyle(fontWeight:FontWeight.bold)),
            const Text('Organiza entregas aceitas/retiradas a partir da sua localização atual.'),
            FilledButton.icon(onPressed:routing?null:optimizeRoute,icon:const Icon(Icons.route),label:Text(routing?'Calculando...':'Otimizar sequência')),
            if (routeInfo != null) Text(routeInfo!),
            for (var i=0;i<optimized.length;i++) ListTile(dense:true,leading:CircleAvatar(child:Text('${i+1}')),title:Text('${optimized[i]['customer_name']}'),subtitle:Text('${optimized[i]['address']}')),
            if (optimized.isNotEmpty) OutlinedButton.icon(onPressed:openOptimizedRoute,icon:const Icon(Icons.map),label:const Text('Abrir rota com paradas no Maps')),
          ]))),

          if (deliveries.isEmpty) const Text('Nenhuma entrega atribuída ainda.'),
          for (final d in deliveries) Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${d['customer_name']}', style: const TextStyle(fontWeight: FontWeight.bold)),
            Text('${d['address']}'),
            if ('${d['notes'] ?? ''}'.isNotEmpty) Text('Observações: ${d['notes']}'),
            Text('Status: ${d['status']} • Repasse: R\$ ${d['courier_payment']}'),
            Wrap(spacing: 8, children: [
              TextButton.icon(onPressed: () => openMap('${d['address']}'), icon: const Icon(Icons.map), label: const Text('Abrir rota')),
              if (d['status'] == 'atribuida') FilledButton(onPressed: updating ? null : () => changeStatus('${d['id']}', 'aceita'), child: const Text('Aceitar')),
              if (d['status'] == 'aceita' && d['batch_id'] == null) FilledButton(onPressed: updating ? null : () => changeStatus('${d['id']}', 'retirada'), child: const Text('Retirei')),
              if (d['status'] == 'aceita' && d['batch_id'] != null && d['collected_at'] == null) FilledButton(onPressed: updating ? null : () => collect('${d['id']}'), child: const Text('Confirmar coleta')),
              if (d['status'] == 'aceita' && d['batch_id'] != null && d['collected_at'] != null) FilledButton(onPressed: updating ? null : () => depart('${d['batch_id']}'), child: const Text('Saiu da loja')),
              if (d['status'] == 'retirada' && d['requires_delivery_code'] == true && d['delivery_code_verified_at'] == null)
                FilledButton(onPressed:updating?null:()=>requestDeliveryCode(d),child:const Text('Validar código')),
              if (d['status'] == 'retirada' && (d['requires_delivery_code'] != true || d['delivery_code_verified_at'] != null))
                FilledButton(onPressed:updating?null:()=>changeStatus('${d['id']}','entregue'),child:const Text('Entreguei')),
            ])
          ]))),
        ]
      ]),
    ));
  }
}
