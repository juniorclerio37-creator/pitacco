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
import android.os.SystemClock;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

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
    static final String CHANNEL = "pitacco_gps_shift_v1";
    static final String EXPECTED_BACKEND = "https://mdevzehqcpcgxspwbiyz.supabase.co";
    private static final int NOTIFICATION_ID = 20811;
    private static final long INTERVAL_MS = 12_000L;
    private static volatile boolean running = false;

    static boolean isRunning() { return running; }

    private LocationManager locations;
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final AtomicBoolean sending = new AtomicBoolean(false);
    private volatile long lastSubmittedMs = 0L;
    private volatile String apiKey;
    private volatile String gpsToken;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
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
                        3f, this, Looper.getMainLooper());
                listening = true;
            }
            if (locations.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locations.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, INTERVAL_MS,
                        3f, this, Looper.getMainLooper());
                listening = true;
            }
            if (!listening) throw new IllegalStateException("Location provider disabled");
            running = true;
            return START_NOT_STICKY;
        } catch (SecurityException | IllegalStateException e) {
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
        try {
            network.execute(() -> {
                try { submitPosition(lat, lng, accuracy); }
                finally { sending.set(false); }
            });
        } catch (java.util.concurrent.RejectedExecutionException ignored) {
            sending.set(false);
        }
    }

    private void submitPosition(double lat, double lng, double accuracy) {
        try {
            JSONObject body = new JSONObject()
                    .put("p_token", gpsToken)
                    .put("p_lat", lat).put("p_lng", lng).put("p_accuracy_m", accuracy);
            ApiResponse result = request("/rest/v1/rpc/pitacco_courier_background_gps_update", body);
            if (result.status == 401 || result.status == 403 ||
                (result.status == 400 && result.body.contains("Requisição de GPS inválida"))) {
                stopSelf(); // expired/revoked token, off shift or account disabled
            }
            // Offline/transient network failure: retry on the next fresh GPS fix.
        } catch (Exception ignored) {
            // Never log bearer tokens, location or customer data.
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
        if (locations != null) {
            try { locations.removeUpdates(this); } catch (SecurityException ignored) {}
        }
        gpsToken = null;
        apiKey = null;
        network.shutdownNow();
        super.onDestroy();
    }
}
