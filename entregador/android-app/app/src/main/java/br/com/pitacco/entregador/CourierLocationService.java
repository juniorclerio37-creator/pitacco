package br.com.pitacco.entregador;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.Handler;
import android.os.SystemClock;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import com.google.android.gms.location.ActivityRecognition;

/**
 * Native on-shift location tracking, started ONLY by the foreground activity.
 * The Android location-type foreground service continues across app background
 * and while Maps/Waze is open, showing an ongoing, stoppable notification.
 * It does NOT silently relaunch after force-stop or a device reboot.
 * Authorization is a 256-bit courier-scoped capability minted by the
 * authenticated web session. Only its SHA-256 hash is stored by the server.
 * It expires automatically and is revoked on offline, disabled or logout.
 * Browser and service never race to rotate the same Supabase refresh token.
 */
public final class CourierLocationService extends Service implements LocationListener {
    static final String ACTION_START = "br.com.pitacco.entregador.location.START";
    static final String ACTION_STOP = "br.com.pitacco.entregador.location.STOP";
    static final String ACTION_REFRESH_MOTION = "br.com.pitacco.entregador.location.REFRESH_MOTION";
    private static final long MOTION_MAX_AGE_MS = 90_000L;
    private static volatile String physicalActivityState = "unknown";
    private static volatile int physicalActivityConfidence = 0;
    private static volatile long physicalActivityUpdatedAt = 0L;
    private static volatile String lastCombinedMotion = "unknown";
    private static volatile long lastCombinedMotionAt = 0L;

    static String motionState() {
        if (!running || lastCombinedMotionAt<=0 ||
            SystemClock.elapsedRealtime()-lastCombinedMotionAt>90_000L)
            return "unknown";
        return lastCombinedMotion;
    }
    static final String CHANNEL = "pitacco_gps_shift_v1";
    static final String EXPECTED_BACKEND = "https://mdevzehqcpcgxspwbiyz.supabase.co";
    private static final int NOTIFICATION_ID = 20811;
    private static final long INTERVAL_MS = 12_000L;
    private static final long ORDER_WATCH_MS = 8_000L;
    private static volatile boolean running = false;

    static boolean isRunning() { return running; }
    private static volatile long startedElapsedMs = 0;
    private static volatile long lastConfirmedUploadElapsedMs = 0;

    /** Native diagnostic: do not report tracking ON without a recent accepted GPS. */
    static String trackingState() {
        if (!running) return "off";
        final long now = SystemClock.elapsedRealtime();
        if (lastConfirmedUploadElapsedMs > 0 &&
                now - lastConfirmedUploadElapsedMs <= 90_000L) return "on";
        if (now - startedElapsedMs < 45_000L) return "waiting";
        return "stale";
    }

    static void recordPhysicalActivity(String state,int confidence) {
        if (!running || (!"moving".equals(state) && !"stopped".equals(state)) ||
            confidence < 65 || confidence > 100) return;
        physicalActivityState=state;
        physicalActivityConfidence=confidence;
        physicalActivityUpdatedAt=SystemClock.elapsedRealtime();
    }

    private PendingIntent motionPendingIntent;
    private boolean motionRequested=false;

    private void startMotionRecognition() {
        if (!running || (Build.VERSION.SDK_INT >= 29 &&
                checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION)
                    != PackageManager.PERMISSION_GRANTED) || motionRequested) return;
        try {
            Intent callback = new Intent(this,CourierMotionReceiver.class)
                .setAction(CourierMotionReceiver.ACTION_UPDATE);
            int flags=PendingIntent.FLAG_UPDATE_CURRENT |
                (Build.VERSION.SDK_INT >= 31?PendingIntent.FLAG_MUTABLE:0);
            motionPendingIntent=PendingIntent.getBroadcast(this,241,callback,flags);
            ActivityRecognition.getClient(this)
                .requestActivityUpdates(15_000L,motionPendingIntent)
                .addOnSuccessListener(ignored -> motionRequested=true)
                .addOnFailureListener(error -> motionRequested=false);
        } catch (RuntimeException ignored) {
            // Optional Google Play services. GPS remains functional.
            motionRequested=false;
        }
    }

    private void stopMotionRecognition() {
        if (motionPendingIntent != null) {
            try { ActivityRecognition.getClient(this)
                .removeActivityUpdates(motionPendingIntent); }
            catch (RuntimeException ignored) {}
            motionPendingIntent=null;
        }
        motionRequested=false;
        physicalActivityState="unknown";
        physicalActivityConfidence=0;
        physicalActivityUpdatedAt=0L;
    }

    private static final class Motion {
        final String state;
        final int confidence;
        final double speed;
        Motion(String state,int confidence,double speed) {
            this.state=state;this.confidence=confidence;this.speed=speed;
        }
    }

    // GPS speed and low-power Android activity sensing are independent signals.
    // Movement is an estimate; a stationary bike at a light is NOT offline.
    private Motion classifyMotion(Location fix) {
        double speed=fix.hasSpeed()?Math.max(0,fix.getSpeed()):Double.NaN;
        boolean reliable=fix.hasSpeed()&&fix.hasSpeedAccuracy()
             &&fix.getSpeedAccuracyMetersPerSecond()<=1.8f
             &&fix.getAccuracy()<=65f;
        if(reliable&&speed>=2.8)return new Motion("moving",90,speed);
        if(reliable&&speed<=0.6&&fix.getAccuracy()<=30f)
            return new Motion("stopped",85,speed);
        if(SystemClock.elapsedRealtime()-physicalActivityUpdatedAt<=MOTION_MAX_AGE_MS
            &&physicalActivityUpdatedAt>0 && physicalActivityConfidence>=65)
            return new Motion(physicalActivityState,physicalActivityConfidence,speed);
        return new Motion("unknown",0,speed);
    }

    private LocationManager locations;
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final AtomicBoolean sending = new AtomicBoolean(false);
    private final AtomicBoolean checkingOrders = new AtomicBoolean(false);
    private final Handler watchHandler = new Handler(Looper.getMainLooper());
    private final HashSet<String> seenAssigned = new HashSet<>();
    private boolean ordersInitialized = false;
    private final Runnable orderWatch = new Runnable() {
        @Override public void run() {
            if (!running) return;
            if (checkingOrders.compareAndSet(false, true)) {
                try {
                    network.execute(() -> {
                        try { checkNewAssignments(); }
                        finally { checkingOrders.set(false); }
                    });
                } catch (java.util.concurrent.RejectedExecutionException ignored) {
                    checkingOrders.set(false);
                }
            }
            if (running) watchHandler.postDelayed(this, ORDER_WATCH_MS);
        }
    };
    private volatile long lastSubmittedMs = 0L;
    private volatile String apiKey;
    private volatile String gpsToken;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_REFRESH_MOTION.equals(intent.getAction())) {
            if (running) startMotionRecognition();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(intent.getAction()) ||
                checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String backend = intent.getStringExtra("backend");
        String key = intent.getStringExtra("apiKey");
        String token = intent.getStringExtra("token");
        if (!EXPECTED_BACKEND.equals(backend) || key == null || key.length() < 20 ||
                token == null || !token.matches("[a-f0-9]{64}")) {
            stopSelf();
            return START_NOT_STICKY;
        }
        apiKey = key;
        gpsToken = token;
        try {
            ensureChannel();
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification(),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification());
            }
            locations = (LocationManager) getSystemService(LOCATION_SERVICE);
            // Refresh every time a shift starts, but never send stale fixes.
            if (locations == null) throw new IllegalStateException("LocationManager unavailable");
            locations.removeUpdates(this);
            boolean listening = false;
            if (locations.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, INTERVAL_MS,
                        0f, this, Looper.getMainLooper());
                listening = true;
            }
            if (locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, INTERVAL_MS,
                        0f, this, Looper.getMainLooper());
                listening = true;
            }
            if (!listening) throw new IllegalStateException("Location provider disabled");
            lastConfirmedUploadElapsedMs = 0;
            startedElapsedMs = SystemClock.elapsedRealtime();
            running = true;
            startMotionRecognition();
            watchHandler.removeCallbacks(orderWatch);
            watchHandler.post(orderWatch);
            return START_NOT_STICKY;
        } catch (RuntimeException e) {
            // Missing location permission or provider -> never claim tracking is on.
            stopSelf();
            return START_NOT_STICKY;
        }
    }

    private void ensureChannel() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL,
                "Rastreamento durante o plantão", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("GPS compartilhado com a loja enquanto o entregador está online");
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }

    private Notification notification() {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent reopen = PendingIntent.getActivity(this, 230, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, CourierLocationService.class).setAction(ACTION_STOP);
        PendingIntent stopAction = PendingIntent.getService(this, 231, stop,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_pitacco)
                .setContentTitle("Pitacco Entregador · GPS ativo")
                .setContentText("Compartilhando localização durante o plantão")
                .setContentIntent(reopen)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .addAction(new Notification.Action.Builder(R.drawable.ic_pitacco,
                        "Parar rastreamento", stopAction).build())
                .build();
    }

    @Override public void onLocationChanged(Location fix) {
        if (!running || fix == null || !fix.hasAccuracy() ||
                !Double.isFinite(fix.getLatitude()) || !Double.isFinite(fix.getLongitude()) ||
                (fix.getLatitude() == 0 && fix.getLongitude() == 0) ||
                fix.getAccuracy() > 100f || fix.getAccuracy() < 0 ||
                SystemClock.elapsedRealtimeNanos() - fix.getElapsedRealtimeNanos() >
                        30_000_000_000L) return;
        long now = SystemClock.elapsedRealtime();
        if (now - lastSubmittedMs < INTERVAL_MS || !sending.compareAndSet(false, true)) return;
        lastSubmittedMs = now;
        final double lat = fix.getLatitude(), lng = fix.getLongitude(), accuracy = fix.getAccuracy();
        final Motion motion=classifyMotion(fix);
        lastCombinedMotion=motion.state;
        lastCombinedMotionAt=SystemClock.elapsedRealtime();
        try {
            network.execute(() -> {
                try { submitPosition(lat,lng,accuracy,motion); }
                finally { sending.set(false); }
            });
        } catch (java.util.concurrent.RejectedExecutionException ignored) {
            sending.set(false);
        }
    }

    private void submitPosition(double lat,double lng,double accuracy,Motion motion) {
        try {
            JSONObject body = new JSONObject()
                .put("p_token",gpsToken)
                .put("p_lat",lat).put("p_lng",lng).put("p_accuracy_m",accuracy)
                .put("p_motion_state",motion.state)
                .put("p_motion_confidence",motion.confidence)
                .put("p_speed_mps",Double.isFinite(motion.speed)
                     ?motion.speed:JSONObject.NULL);
            ApiResponse result=request(
                "/rest/v1/rpc/pitacco_courier_background_gps_update_motion",body);
            if(result.status==404){
                // Compatibility if the new optional motion RPC is unavailable:
                // keep sending authenticated GPS via the original endpoint.
                JSONObject basic=new JSONObject().put("p_token",gpsToken)
                    .put("p_lat",lat).put("p_lng",lng)
                    .put("p_accuracy_m",accuracy);
                result=request("/rest/v1/rpc/pitacco_courier_background_gps_update",basic);
            }
            if (result.status >= 200 && result.status < 300) {
                lastConfirmedUploadElapsedMs = SystemClock.elapsedRealtime();
            }
            if (result.status == 401 || result.status == 403 ||
                (result.status == 400 && result.body.contains("Requisição de GPS inválida"))) {
                stopSelf(); // expired/revoked token, off shift or account disabled
            }
            // Offline/transient network failure: retry on the next fresh GPS fix.
        } catch (Exception ignored) {
            // Never log bearer tokens, location or customer data.
        }
    }

    /**
     * Notification fallback when Firebase is not yet configured server-side.
     * This thread runs in Android's already-consented GPS foreground service,
     * not in the WebView. It sees only UUIDs of deliveries assigned to THIS
     * logged-in, online courier. Never poll for platform-partner deliveries.
     */
    private void checkNewAssignments() {
        if (!MainActivity.isPushOptedIn(this) || gpsToken == null) return;
        try {
            JSONObject payload = new JSONObject().put("p_token", gpsToken);
            ApiResponse response = request("/rest/v1/rpc/pitacco_courier_background_assignments", payload);
            if (response.status == 401 || response.status == 403) {
                stopSelf(); // revoked, logged out or offline
                return;
            }
            if (response.status != 200) return;
            JSONArray assigned = new JSONArray(response.body);
            HashSet<String> currentIds = new HashSet<>();
            for (int i = 0; i < assigned.length(); i++) {
                JSONObject entry = assigned.optJSONObject(i);
                if (entry == null) continue;
                String id = entry.optString("id");
                String eventId = entry.optString("event_id");
                if (!id.matches("(?i)[a-f0-9-]{36}") ||
                        !eventId.matches("(?i)[a-f0-9-]{36}")) continue;
                currentIds.add(id);
                // Initial synchronization never floods the phone with
                // deliveries that were assigned before opening the shift.
                if (ordersInitialized && !seenAssigned.contains(id)) {
                    AssignmentMessagingService.showAssignment(this, eventId);
                }
            }
            seenAssigned.addAll(currentIds);
            ordersInitialized = true;
        } catch (Exception ignored) {
            // No customer identifiers, tokens or network failures in logs.
            // Retry with the next poll; do not mark failed events as delivered.
        }
    }

    private ApiResponse request(String path, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection)
                new URL(EXPECTED_BACKEND + path).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(7000);
        connection.setReadTimeout(7000);
        connection.setInstanceFollowRedirects(false);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("apikey", apiKey);
        try {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream stream = connection.getOutputStream()) { stream.write(bytes); }
            int status = connection.getResponseCode();
            InputStream input = status < 400 ?
                    connection.getInputStream() : connection.getErrorStream();
            ByteArrayOutputStream bytesOut = new ByteArrayOutputStream();
            if (input != null) try (InputStream stream = input) {
                byte[] buffer = new byte[1024];
                int size;
                while ((size = stream.read(buffer)) >= 0 && bytesOut.size() < 8192) {
                    bytesOut.write(buffer, 0, Math.min(size, 8192 - bytesOut.size()));
                }
            }
            return new ApiResponse(status, bytesOut.toString("UTF-8"));
        } finally { connection.disconnect(); }
    }

    private static final class ApiResponse {
        final int status;
        final String body;
        ApiResponse(int status, String body) { this.status = status; this.body = body; }
    }

    @Override public void onDestroy() {
        running = false;
        startedElapsedMs = 0;
        lastConfirmedUploadElapsedMs = 0;
        lastCombinedMotion = "unknown";
        lastCombinedMotionAt = 0L;
        watchHandler.removeCallbacks(orderWatch);
        stopMotionRecognition();
        if (locations != null) {
            try { locations.removeUpdates(this); } catch (SecurityException ignored) {}
        }
        gpsToken = null;
        apiKey = null;
        network.shutdownNow();
        super.onDestroy();
    }
}
