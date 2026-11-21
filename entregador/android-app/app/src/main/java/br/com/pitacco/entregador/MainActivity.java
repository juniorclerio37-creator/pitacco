package br.com.pitacco.entregador;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.os.Build;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.Collections;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String HOST = "entregador.pitacco.com.br";
    private static final String HOME = "https://" + HOST + "/";

    private static final int PUSH_PERMISSION = 94;
    private static final int FIRST_OPEN_NOTIFICATION_PERMISSION = 95;
    private static final int LOCATION_PERMISSION = 96;
    private static final int BACKGROUND_LOCATION_PERMISSION = 97;
    private static final int ACTIVITY_RECOGNITION_PERMISSION = 98;
    private static final String INITIAL_SETUP_PREFS = "pitacco_delivery_initial_setup";
    private static final String INITIAL_SETUP_DONE = "completed_v1";
    private static final String GPS_SETUP_DONE = "gps_permission_explained_209";
    private JavaScriptReplyProxy pendingPermission;
    private GeolocationPermissions.Callback pendingLocationCallback;
    private String pendingLocationOrigin;
    private JavaScriptReplyProxy pendingGpsReply;
    private JavaScriptReplyProxy pendingBackgroundGpsReply;
    private JavaScriptReplyProxy pendingPhysicalActivityReply;
    private WebView web;
    private LinearLayout offline;

    private static boolean isHttps(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme())
                && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        offline = new LinearLayout(this);
        offline.setOrientation(LinearLayout.VERTICAL);
        offline.setGravity(android.view.Gravity.CENTER);
        offline.setPadding(24, 24, 24, 24);
        TextView explanation = new TextView(this);
        explanation.setText("Não foi possível conectar ao Pitacco. Confira a internet e tente novamente.");
        explanation.setGravity(android.view.Gravity.CENTER);
        offline.addView(explanation);
        Button retry = new Button(this);
        retry.setText("Tentar novamente");
        retry.setOnClickListener(view -> {
            offline.setVisibility(View.GONE);
            web.setVisibility(View.VISIBLE);
            if (web.getUrl() == null) web.loadUrl(HOME);
            else web.reload();
        });
        offline.addView(retry);
        offline.setVisibility(View.GONE);
        root.addView(web);
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(
                    String origin, GeolocationPermissions.Callback callback) {
                // Only the authenticated courier website can ask for GPS.
                // Some WebViews report a canonical origin with a default
                // port; validate its host and HTTPS instead of raw equality.
                Uri requestedOrigin;
                try { requestedOrigin = Uri.parse(origin); }
                catch (Exception error) { callback.invoke(origin, false, false); return; }
                if (!isHttps(requestedOrigin) ||
                        !HOST.equalsIgnoreCase(requestedOrigin.getHost())) {
                    callback.invoke(origin, false, false);
                    return;
                }
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED ||
                    checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED) {
                    // Persist ONLY the already OS-authorized first-party
                    // courier origin so WebView does not keep asking.
                    callback.invoke(origin, true, true);
                    return;
                }
                pendingLocationOrigin = origin;
                pendingLocationCallback = callback;
                requestPermissions(new String[]{
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_PERMISSION);
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                return handleLink(request.getUrl());
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse error) {
                if (request.isForMainFrame() && error.getStatusCode() >= 400) showOffline();
            }
        });
        ShiftSoundPlayer.recover(this);
        preparePush();
        registerGpsBridge();
        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
        if (state == null) showFirstOpenSetup();
    }

    /**
     * Android grants INTERNET and MODIFY_AUDIO_SETTINGS at install time.
     * Notification permission is requested for push. Location is requested
     * after the courier explicitly accepts the Android permission dialog.
     * Location reporting remains restricted to an active shift in the web app.
     * Background GPS requires a separate foreground service and is NOT claimed.
     */
    private void showFirstOpenSetup() {
        SharedPreferences prefs = getSharedPreferences(INITIAL_SETUP_PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(INITIAL_SETUP_DONE, false)) {
            showGpsPermissionSetup();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Configurar alertas do Pitacco")
                .setMessage("Para avisar quando chegar uma nova entrega, o Pitacco precisa de permissão para mostrar notificações. Em seguida você pode ativar o Modo Plantão: sino e voz em volume alto, com tentativa de restaurar o volume original após o alerta. O Android pode restringir o som no modo Não Perturbe.")
                .setCancelable(false)
                .setPositiveButton("Configurar agora", (dialog, which) -> {
                    prefs.edit().putBoolean(INITIAL_SETUP_DONE, true).apply();
                    requestFirstOpenNotifications();
                })
                .setNegativeButton("Agora não", (dialog, which) -> {
                    prefs.edit().putBoolean(INITIAL_SETUP_DONE, true).apply();
                    showGpsPermissionSetup();
                })
                .show();
    }

    private void requestFirstOpenNotifications() {
        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                        PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    FIRST_OPEN_NOTIFICATION_PERMISSION);
        } else {
            finishFirstOpenNotifications();
        }
    }

    private void finishFirstOpenNotifications() {
        boolean granted = Build.VERSION.SDK_INT < 33 ||
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                        PackageManager.PERMISSION_GRANTED;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (granted && manager != null && manager.areNotificationsEnabled()) {
            // The courier has explicitly opted in on the initial setup.
            // Registration still happens only after authenticated web login.
            getPreferences(MODE_PRIVATE).edit().putBoolean("push_enabled", true).apply();
            if (!FirebaseApp.getApps(this).isEmpty())
                FirebaseMessaging.getInstance().setAutoInitEnabled(true);
        } else {
            Toast.makeText(this, "Ative as notificações nos Ajustes para receber entregas.",
                    Toast.LENGTH_LONG).show();
        }
        new AlertDialog.Builder(this)
                .setTitle("Ativar Modo Plantão?")
                .setMessage("Quando receber uma entrega, o Pitacco tentará aumentar temporariamente o volume de alarme para tocar o sino e a voz, depois restaurará o valor anterior. O recurso é opcional, não altera o Não Perturbe e pode ser bloqueado pelo Android. Você pode desligá-lo nos Ajustes.")
                .setPositiveButton("Ativar som forte", (dialog, which) -> {
                    ShiftSoundPlayer.setEnabled(this, true);
                    Toast.makeText(this, "Modo Plantão ativado.", Toast.LENGTH_SHORT).show();
                    showGpsPermissionSetup();
                })
                .setNegativeButton("Manter desligado", (dialog, which) -> showGpsPermissionSetup())
                .show();
    }

    /**
     * Version 2.0.9 adds an explicit, one-time GPS prompt to upgrades as well
     * as fresh installations. The user controls the Android permission and the
     * courier must still go online before coordinates are sent to Pitacco.
     */
    private void showGpsPermissionSetup() {
        if (!"denied".equals(locationPermissionState())) return;
        SharedPreferences prefs = getSharedPreferences(INITIAL_SETUP_PREFS, MODE_PRIVATE);
        if (prefs.getBoolean(GPS_SETUP_DONE, false)) return;
        new AlertDialog.Builder(this)
                .setTitle("Autorizar localização do Pitacco?")
                .setMessage("O Pitacco precisa da localização precisa para atribuir entregas e acompanhar o trajeto durante o plantão. Quando o rastreamento contínuo estiver ativo, o GPS poderá continuar com o aplicativo minimizado e a tela apagada. O envio é encerrado ao ficar offline.")
                .setPositiveButton("Permitir localização", (dialog, which) -> {
                    prefs.edit().putBoolean(GPS_SETUP_DONE, true).apply();
                    requestPermissions(new String[]{
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_PERMISSION);
                })
                .setNegativeButton("Mais tarde", (dialog, which) -> {
                    prefs.edit().putBoolean(GPS_SETUP_DONE, true).apply();
                })
                .show();
    }

    // Runtime GPS authorization is independent of the online shift state.
    // Only the authenticated courier page may trigger this bridge.
    private void registerGpsBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(web, "PitaccoGps",
                Collections.singleton("https://" + HOST),
                (view, message, origin, mainFrame, reply) -> {
                    if (!mainFrame || !isHttps(origin) ||
                            !HOST.equalsIgnoreCase(origin.getHost())) return;
                    String action = message.getData();
                    if ("status".equals(action)) {
                        reply.postMessage(locationPermissionState());
                    } else if ("site_status".equals(action)) {
                        GeolocationPermissions.getInstance().getAllowed(
                                "https://" + HOST,
                                allowed -> reply.postMessage(Boolean.TRUE.equals(allowed)
                                        ? "site:granted" : "site:not_granted"));
                    } else if ("site_reset".equals(action)) {
                        // User explicitly tapped 'Atualizar GPS'. Never change
                        // Android permissions. Clear ONLY an old WebView
                        // permission decision for our authenticated origin.
                        if ("denied".equals(locationPermissionState())) {
                            reply.postMessage("site:android_denied");
                        } else {
                            GeolocationPermissions.getInstance().clear("https://" + HOST);
                            reply.postMessage("site:reset");
                        }
                    } else if ("tracking_status".equals(action)) {
                        reply.postMessage("tracking:" + CourierLocationService.trackingState());
                    } else if ("motion_status".equals(action)) {
                        reply.postMessage("motion:" + CourierLocationService.motionState());
                    } else if ("background_status".equals(action)) {
                        reply.postMessage(backgroundPermissionState());
                    } else if ("activity_status".equals(action)) {
                        reply.postMessage("activity:" + activityPermissionState());
                    } else if ("activity_request".equals(action)) {
                        requestPhysicalActivityPermission(reply);
                    } else if ("activity_settings".equals(action)) {
                        Intent settings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.parse("package:" + getPackageName()));
                        openExternal(settings);
                        reply.postMessage("activity:settings");
                    } else if ("background_request".equals(action)) {
                        showBackgroundLocationDisclosure(reply);
                    } else if ("stop".equals(action)) {
                        stopService(new Intent(this, CourierLocationService.class));
                        reply.postMessage("tracking:off");
                    } else if (action != null && action.startsWith("start:")) {
                        // The page is origin-limited to the authenticated courier
                        // site. A shift-scoped GPS capability, never the user's login or
                        // refresh token, is sent to this non-exported service.
                        if (!"granted".equals(locationPermissionState()) ||
                                action.length() > 16000) {
                            reply.postMessage("tracking:permission");
                            return;
                        }
                        try {
                            JSONObject credentials = new JSONObject(action.substring(6));
                            String backend = credentials.optString("backend");
                            String apiKey = credentials.optString("apiKey");
                            String token = credentials.optString("token");
                            if (!CourierLocationService.EXPECTED_BACKEND.equals(backend) ||
                                    apiKey.length() < 20 || !token.matches("[a-f0-9]{64}")) {
                                reply.postMessage("tracking:invalid_session");
                                return;
                            }
                            Intent tracking = new Intent(this, CourierLocationService.class);
                            tracking.setAction(CourierLocationService.ACTION_START);
                            tracking.putExtra("backend", backend);
                            tracking.putExtra("apiKey", apiKey);
                            tracking.putExtra("token", token);
                            startForegroundService(tracking);
                            reply.postMessage("tracking:starting");
                        } catch (Exception e) {
                            reply.postMessage("tracking:error");
                        }
                    } else if ("request".equals(action)) {
                        String state = locationPermissionState();
                        if (!"denied".equals(state)) {
                            reply.postMessage(state);
                            return;
                        }
                        if (pendingGpsReply != null) {
                            reply.postMessage("request_running");
                            return;
                        }
                        SharedPreferences prefs = getPreferences(MODE_PRIVATE);
                        boolean asked = prefs.getBoolean("gps_permission_requested", false);
                        if (asked &&
                                !shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION) &&
                                !shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                            reply.postMessage("settings");
                            return;
                        }
                        pendingGpsReply = reply;
                        prefs.edit().putBoolean("gps_permission_requested", true).apply();
                        requestPermissions(new String[]{
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_PERMISSION);
                    } else if ("settings".equals(action)) {
                        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.parse("package:" + getPackageName()));
                        openExternal(intent);
                    }
                });
    }

    /**
     * Android 11+ deliberately requires the courier to choose "Permitir o tempo
     * todo" in system Settings AFTER granting foreground precise location.
     * This permission is optional and never enables a shift by itself.
     */
    private String backgroundPermissionState() {
        if (Build.VERSION.SDK_INT < 29) return "background:granted";
        if (checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == PackageManager.PERMISSION_GRANTED) return "background:granted";
        return "background:denied";
    }

    private void showBackgroundLocationDisclosure(JavaScriptReplyProxy reply) {
        if (!"granted".equals(locationPermissionState())) {
            reply.postMessage("background:foreground_required");
            return;
        }
        if ("background:granted".equals(backgroundPermissionState())) {
            reply.postMessage("background:granted");
            return;
        }
        new AlertDialog.Builder(this)
            .setTitle("Localização durante o plantão")
            .setMessage("O Pitacco Entregador compartilha sua localização precisa com a loja " +
                "quando você está online, mesmo com o aplicativo minimizado ou a tela apagada. " +
                "O cliente acompanha apenas uma posição aproximada da própria entrega após a coleta. " +
                "Ao ficar offline, sair da conta ou tocar em Parar rastreamento, o envio é interrompido. " +
                "Para autorizar, escolha Localização > Permitir o tempo todo nas configurações do Android. " +
                "A permissão é opcional e não ativa o plantão automaticamente.")
            .setPositiveButton(Build.VERSION.SDK_INT >= 30
                ? "Abrir configurações" : "Autorizar agora", (dialog, which) -> {
                if (Build.VERSION.SDK_INT >= 30) {
                    Intent settings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:" + getPackageName()));
                    openExternal(settings);
                    reply.postMessage("background:settings");
                } else if (Build.VERSION.SDK_INT == 29) {
                    pendingBackgroundGpsReply = reply;
                    requestPermissions(new String[]{
                            Manifest.permission.ACCESS_BACKGROUND_LOCATION
                    }, BACKGROUND_LOCATION_PERMISSION);
                } else {
                    reply.postMessage("background:granted");
                }
            })
            .setNegativeButton("Mais tarde", (dialog, which) ->
                    reply.postMessage("background:denied"))
            .show();
    }

    /**
     * Physical Activity / ACTIVITY_RECOGNITION is opt-in, introduced as a
     * runtime permission on Android 10. It does not provide GPS coordinates
     * and is never a prerequisite for background location or new orders.
     */
    private String activityPermissionState() {
        if (Build.VERSION.SDK_INT < 29) return "unavailable";
        return checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION)
                == PackageManager.PERMISSION_GRANTED ? "granted" : "denied";
    }

    private void requestPhysicalActivityPermission(JavaScriptReplyProxy reply) {
        if (Build.VERSION.SDK_INT < 29) {
            reply.postMessage("activity:unavailable");
            return;
        }
        if ("granted".equals(activityPermissionState())) {
            reply.postMessage("activity:granted");
            return;
        }
        if (pendingPhysicalActivityReply != null) {
            reply.postMessage("activity:request_running");
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Permitir Atividade física?")
                .setMessage("A permissão é opcional e permite ao Android oferecer dados de movimento. Ela não substitui o GPS e não ativa o rastreamento nem coleta dados de atividade por conta própria. Você pode revogá-la nos ajustes do sistema.")
                .setPositiveButton("Solicitar permissão", (dialog, which) -> {
                    pendingPhysicalActivityReply = reply;
                    requestPermissions(
                            new String[]{Manifest.permission.ACTIVITY_RECOGNITION},
                            ACTIVITY_RECOGNITION_PERMISSION);
                })
                .setNegativeButton("Agora não", (dialog, which) ->
                        reply.postMessage("activity:declined"))
                .show();
    }

    private String locationPermissionState() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED) return "granted";
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED) return "approximate";
        return "denied";
    }

    private void preparePush() {
        AssignmentMessagingService.ensureChannel(this);
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(web, "PitaccoPush", Collections.singleton("https://" + HOST),
                (view, message, origin, mainFrame, reply) -> {
                    if (!mainFrame || !isHttps(origin) || !HOST.equalsIgnoreCase(origin.getHost())) return;
                    String action = message.getData();
                    if ("enable".equals(action)) enablePush(reply);
                    else if ("refresh".equals(action) && pushEnabled()) sendToken(reply);
                    else if ("test".equals(action)) {
                        String status = AssignmentMessagingService.notificationStatus(this);
                        if ("ready".equals(status) || "channel_silent".equals(status)) {
                            boolean posted = AssignmentMessagingService.showAssignment(this,
                                    "00000000-0000-4000-8000-000000000001");
                            if (posted && ShiftSoundPlayer.isEnabled(this))
                                reply.postMessage("shift_test:" + ShiftSoundPlayer.getLastResult());
                            else reply.postMessage(posted ?
                                    ("ready".equals(status) ? "tested" : "channel_silent") :
                                    "channel_disabled");
                        } else reply.postMessage(status);
                    }
                    else if ("status".equals(action)) {
                        reply.postMessage("notification_status:" +
                                AssignmentMessagingService.notificationStatus(this));
                        reply.postMessage(ShiftSoundPlayer.isEnabled(this)
                                ? "shift_sound:on" : "shift_sound:off");
                    }
                    else if ("shift_enable".equals(action)) {
                        // This action is only sent after an explicit confirmation
                        // in the authenticated courier's Settings screen.
                        ShiftSoundPlayer.setEnabled(this, true);
                        reply.postMessage("shift_sound:on");
                    }
                    else if ("shift_disable".equals(action)) {
                        ShiftSoundPlayer.setEnabled(this, false);
                        reply.postMessage("shift_sound:off");
                    }
                    else if ("shift_status".equals(action)) {
                        reply.postMessage(ShiftSoundPlayer.isEnabled(this)
                                ? "shift_sound:on" : "shift_sound:off");
                    }
                    else if ("settings".equals(action)) {
                        // If Android has not granted global notification permission,
                        // open the app's main notification settings instead of the
                        // disabled category-level switch.
                        String state = AssignmentMessagingService.notificationStatus(this);
                        Intent settings;
                        if ("permission".equals(state)) {
                            settings = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                            settings.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                        } else {
                            settings = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
                            settings.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                            settings.putExtra(Settings.EXTRA_CHANNEL_ID,
                                    ShiftSoundPlayer.isEnabled(this) ?
                                    AssignmentMessagingService.SHIFT_CHANNEL_ID :
                                    AssignmentMessagingService.CHANNEL_ID);
                        }
                        startActivity(settings);
                    }
                    else if ("disable".equals(action)) {
                        getPreferences(MODE_PRIVATE).edit().putBoolean("push_enabled", false).apply();
                        if (!FirebaseApp.getApps(this).isEmpty()) {
                            FirebaseMessaging.getInstance().setAutoInitEnabled(false);
                        }
                    }
                });
    }

    /**
     * Activity.getPreferences(MODE_PRIVATE) uses the local class name ("MainActivity").
     * Use this same preference from FirebaseMessagingService so a stale FCM token
     * cannot play a delivery alert after courier opt-out or logout.
     */
    public static boolean isPushOptedIn(android.content.Context context) {
        return context.getSharedPreferences(MainActivity.class.getSimpleName(),
                MODE_PRIVATE).getBoolean("push_enabled", false);
    }

    private boolean pushEnabled() {
        return isPushOptedIn(this)
                && getSystemService(NotificationManager.class).areNotificationsEnabled();
    }

    private void enablePush(JavaScriptReplyProxy reply) {
        // Notification permission is independent of Firebase. The parallel QA
        // app intentionally has no FCM registration, but must still request
        // POST_NOTIFICATIONS to test its native chime on Android 13+.
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            pendingPermission = reply;
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, PUSH_PERMISSION);
        } else if (!getSystemService(NotificationManager.class).areNotificationsEnabled()) {
            reply.postMessage("permission");
        } else {
            finishPushEnable(reply);
        }
    }

    private void finishPushEnable(JavaScriptReplyProxy reply) {
        AssignmentMessagingService.ensureChannel(this);
        if (FirebaseApp.getApps(this).isEmpty()) {
            // Local notification test can now work. Background FCM remains
            // unavailable until the QA app is registered in Firebase.
            reply.postMessage("unavailable");
            return;
        }
        FirebaseMessaging.getInstance().setAutoInitEnabled(true);
        getPreferences(MODE_PRIVATE).edit().putBoolean("push_enabled", true).apply();
        sendToken(reply);
    }

    private void sendToken(JavaScriptReplyProxy reply) {
        if (FirebaseApp.getApps(this).isEmpty()) return;
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(this, result -> {
            if (!result.isSuccessful() || result.getResult() == null) reply.postMessage("failed");
            // Native courier Android 2.0 supports data-only FCM with explicit
            // notification and audible alarm. Old APKs still send "token:".
            else reply.postMessage("token_native:" + result.getResult());
        });
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == LOCATION_PERMISSION) {
            String state = locationPermissionState();
            GeolocationPermissions.Callback callback = pendingLocationCallback;
            String origin = pendingLocationOrigin;
            pendingLocationCallback = null;
            pendingLocationOrigin = null;
            if (callback != null) {
                callback.invoke(origin, "granted".equals(state) || "approximate".equals(state), false);
            }
            JavaScriptReplyProxy gpsReply = pendingGpsReply;
            pendingGpsReply = null;
            if (gpsReply != null) {
                if ("denied".equals(state) &&
                        !shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION) &&
                        !shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                    gpsReply.postMessage("settings");
                } else gpsReply.postMessage(state);
            }
            return;
        }
        if (requestCode == BACKGROUND_LOCATION_PERMISSION) {
            if (pendingBackgroundGpsReply != null) {
                pendingBackgroundGpsReply.postMessage(backgroundPermissionState());
                pendingBackgroundGpsReply = null;
            }
            return;
        }
        if (requestCode == ACTIVITY_RECOGNITION_PERMISSION) {
            JavaScriptReplyProxy activityReply = pendingPhysicalActivityReply;
            pendingPhysicalActivityReply = null;
            String state = activityPermissionState();
            if ("granted".equals(state) && CourierLocationService.isRunning()) {
                // Register optional sensors immediately without restarting the
                // shift, revoking its token or affecting GPS service uptime.
                Intent refresh = new Intent(this, CourierLocationService.class);
                refresh.setAction(CourierLocationService.ACTION_REFRESH_MOTION);
                startService(refresh);
            }
            if (activityReply != null) {
                if ("denied".equals(state) &&
                        !shouldShowRequestPermissionRationale(
                                Manifest.permission.ACTIVITY_RECOGNITION)) {
                    activityReply.postMessage("activity:settings");
                } else activityReply.postMessage("activity:" + state);
            }
            return;
        }
        if (requestCode == FIRST_OPEN_NOTIFICATION_PERMISSION) {
            finishFirstOpenNotifications();
            return;
        }
        if (requestCode != PUSH_PERMISSION || pendingPermission == null) return;
        JavaScriptReplyProxy reply = pendingPermission;
        pendingPermission = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) finishPushEnable(reply);
        else reply.postMessage("permission");
    }

    private boolean handleLink(Uri uri) {
        if (uri == null) return true;
        String host = uri.getHost();
        if (isHttps(uri) && HOST.equalsIgnoreCase(host)) return false;
        String path = uri.getPath();
        if (isHttps(uri) && path != null && (
                (("www.google.com".equalsIgnoreCase(host) || "maps.google.com".equalsIgnoreCase(host))
                    && (path.startsWith("/maps/dir/") || path.startsWith("/maps/")))
                || (("waze.com".equalsIgnoreCase(host) || "www.waze.com".equalsIgnoreCase(host))
                    && "/ul".equals(path))
                || ("confirmacao-entrega-propria.ifood.com.br".equalsIgnoreCase(host) && ("/".equals(path)||path.isEmpty()))
                || ("wa.me".equalsIgnoreCase(host) && path.matches("/[0-9]+"))
                || ("app.pitacco.com.br".equalsIgnoreCase(host) && path.startsWith("/app/")))) {
            openExternal(new Intent(Intent.ACTION_VIEW, uri));
        } else if ("tel".equalsIgnoreCase(uri.getScheme())
                && uri.getSchemeSpecificPart().matches("\\+?[0-9]{8,15}(,[0-9]{1,16})?")) {
            openExternal(new Intent(Intent.ACTION_DIAL, uri));
        }
        return true;
    }

    private void openExternal(Intent intent) {
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException | SecurityException error) {
            Toast.makeText(this, "Nenhum aplicativo disponível para abrir este link.", Toast.LENGTH_LONG).show();
        }
    }

    private void showOffline() {
        web.setVisibility(View.GONE);
        offline.setVisibility(View.VISIBLE);
    }

    /** Recheck orders when the driver taps a native delivery notification. */
    @Override protected void onResume() {
        super.onResume();
        if (web != null) {
            web.evaluateJavascript(
                "window.PitaccoGps?.postMessage?.('status');" +
                "window.PitaccoGps?.postMessage?.('activity_status');" +
                "window.PitaccoGps?.postMessage?.('site_status');" +
                "window.PitaccoGps?.postMessage?.('background_status');" +
                "window.PitaccoGps?.postMessage?.('tracking_status')", null);
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (web != null && intent != null &&
                intent.getBooleanExtra("pitacco_assignment_alert", false)) {
            web.evaluateJavascript(
                    "(function(){var button=document.getElementById('refresh');" +
                    "if(button)button.click();})()", null);
            intent.removeExtra("pitacco_assignment_alert");
        }
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        web.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
