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

    private static final int FIRST_OPEN_NOTIFICATION_PERMISSION = 95;
    private static final int LOCATION_PERMISSION = 96;
    private static final int BACKGROUND_LOCATION_PERMISSION = 97;
    private static final int ACTIVITY_RECOGNITION_PERMISSION = 98;
    private static final int BACKGROUND_LOCATION_SETTINGS = 99;
    private static final String INITIAL_SETUP_PREFS = "pitacco_delivery_initial_setup";
    private static final String SETUP_STEP = "permission_setup_v2_step";
    private static final int SETUP_DONE = 5;
    private boolean waitingForSystem;
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
                // Android permissions are changed during initial setup or in system settings.
                callback.invoke(origin, false, false);
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
        if (state == null || web.restoreState(state) == null) {
            Intent launch=getIntent();
            boolean admin=launch!=null && launch.getBooleanExtra("pitacco_admin_message",false);
            web.loadUrl(admin?HOME+"#config":HOME);
        }
        waitingForSystem = state != null && state.getBoolean("permission_setup_waiting");
        if (!waitingForSystem) showFirstOpenSetup();
    }

    private SharedPreferences setupPreferences() {
        return getSharedPreferences(INITIAL_SETUP_PREFS, MODE_PRIVATE);
    }

    private void showFirstOpenSetup() {
        SharedPreferences prefs = setupPreferences();
        int step = prefs.getInt(SETUP_STEP, -1);
        if (step >= SETUP_DONE) return;
        if (step >= 0) {
            continuePermissionSetup(step);
            return;
        }
        boolean alreadyConfigured = prefs.getBoolean("completed_v1", false)
                && !"permission".equals(AssignmentMessagingService.notificationStatus(this))
                && "granted".equals(locationPermissionState())
                && "background:granted".equals(backgroundPermissionState())
                && !"denied".equals(activityPermissionState());
        if (alreadyConfigured) {
            continuePermissionSetup(SETUP_DONE);
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Permissões do Pitacco Entregador")
                .setMessage("O Android vai pedir notificações, localização precisa e acesso em segundo plano para avisos e GPS durante o plantão. A atividade física é opcional e ajuda a identificar movimento. Você pode mudar sua escolha nas configurações do celular. O GPS só é enviado durante um plantão online.")
                .setPositiveButton("Continuar", (dialog, which) -> continuePermissionSetup(0))
                .setNegativeButton("Agora não", (dialog, which) -> continuePermissionSetup(SETUP_DONE))
                .setCancelable(false)
                .show();
    }

    private void continuePermissionSetup(int step) {
        setupPreferences().edit().putInt(SETUP_STEP, step).apply();
        switch (step) {
            case 0:
                if (Build.VERSION.SDK_INT >= 33 &&
                        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestSetupPermissions(FIRST_OPEN_NOTIFICATION_PERMISSION, Manifest.permission.POST_NOTIFICATIONS);
                } else continuePermissionSetup(1);
                break;
            case 1:
                if (!"granted".equals(locationPermissionState())) {
                    requestSetupPermissions(LOCATION_PERMISSION, Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION);
                } else continuePermissionSetup(2);
                break;
            case 2:
                if (Build.VERSION.SDK_INT >= 29 && "granted".equals(locationPermissionState())
                        && !"background:granted".equals(backgroundPermissionState())) {
                    showBackgroundLocationDisclosure();
                } else continuePermissionSetup(3);
                break;
            case 3:
                if (Build.VERSION.SDK_INT >= 29 && "denied".equals(activityPermissionState())) {
                    requestSetupPermissions(ACTIVITY_RECOGNITION_PERMISSION, Manifest.permission.ACTIVITY_RECOGNITION);
                } else continuePermissionSetup(4);
                break;
            case 4:
                if (setupPreferences().getBoolean("completed_v1", false)
                        || "permission".equals(AssignmentMessagingService.notificationStatus(this))) {
                    continuePermissionSetup(SETUP_DONE);
                } else {
                    new AlertDialog.Builder(this)
                            .setTitle("Som forte durante o plantão")
                            .setMessage("Opcional: o Pitacco pode elevar temporariamente o volume de alarme para tocar o sino e a voz e depois restaurar o volume anterior. As permissões e os canais de notificações ficam nas configurações do Android.")
                            .setPositiveButton("Ativar som forte", (dialog, which) -> {
                                ShiftSoundPlayer.setEnabled(this, true);
                                continuePermissionSetup(SETUP_DONE);
                            })
                            .setNegativeButton("Manter padrão", (dialog, which) -> continuePermissionSetup(SETUP_DONE))
                            .setCancelable(false)
                            .show();
                }
                break;
            default:
                if (web != null) web.evaluateJavascript(
                        "window.dispatchEvent(new Event('pitacco-permissions-ready'))", null);
        }
    }

    private void requestSetupPermissions(int requestCode, String... permissions) {
        waitingForSystem = true;
        requestPermissions(permissions, requestCode);
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

    private void showBackgroundLocationDisclosure() {
        new AlertDialog.Builder(this)
                .setTitle("Localização durante o plantão")
                .setMessage("Para manter o GPS durante seu plantão, mesmo com a tela apagada, escolha Permissões → Localização → Permitir o tempo todo. Essa autorização não ativa o plantão. Ao ficar offline ou sair da conta, o envio é interrompido.")
                .setPositiveButton(Build.VERSION.SDK_INT >= 30 ? "Abrir configurações" : "Solicitar permissão",
                        (dialog, which) -> {
                            if (Build.VERSION.SDK_INT >= 30) {
                                Intent settings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                        Uri.parse("package:" + getPackageName()));
                                try {
                                    waitingForSystem = true;
                                    startActivityForResult(settings, BACKGROUND_LOCATION_SETTINGS);
                                } catch (android.content.ActivityNotFoundException error) {
                                    waitingForSystem = false;
                                    continuePermissionSetup(3);
                                }
                            } else {
                                requestSetupPermissions(BACKGROUND_LOCATION_PERMISSION,
                                        Manifest.permission.ACCESS_BACKGROUND_LOCATION);
                            }
                        })
                .setNegativeButton("Agora não", (dialog, which) -> continuePermissionSetup(3))
                .setCancelable(false)
                .show();
    }

    private String activityPermissionState() {
        if (Build.VERSION.SDK_INT < 29) return "unavailable";
        return checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION)
                == PackageManager.PERMISSION_GRANTED ? "granted" : "denied";
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
        if ("permission".equals(AssignmentMessagingService.notificationStatus(this))) {
            reply.postMessage("permission");
            return;
        }
        finishPushEnable(reply);
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
            else reply.postMessage("token_admin:" + result.getResult());
        });
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        waitingForSystem = false;
        if (requestCode == FIRST_OPEN_NOTIFICATION_PERMISSION) continuePermissionSetup(1);
        else if (requestCode == LOCATION_PERMISSION) continuePermissionSetup(2);
        else if (requestCode == BACKGROUND_LOCATION_PERMISSION) continuePermissionSetup(3);
        else if (requestCode == ACTIVITY_RECOGNITION_PERMISSION) continuePermissionSetup(4);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == BACKGROUND_LOCATION_SETTINGS) {
            waitingForSystem = false;
            continuePermissionSetup(3);
        }
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
        if (CourierLocationService.isRunning() && "granted".equals(activityPermissionState())) {
            Intent refreshMotion = new Intent(this, CourierLocationService.class)
                    .setAction(CourierLocationService.ACTION_REFRESH_MOTION);
            startService(refreshMotion);
        }
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
                intent.getBooleanExtra("pitacco_admin_message",false)) {
            web.evaluateJavascript("window.location.hash='config';"+
                "document.getElementById('adminInboxRefresh')?.click();",null);
            intent.removeExtra("pitacco_admin_message");
        }
        if (web != null && intent != null &&
                intent.getBooleanExtra("pitacco_assignment_alert", false)) {
            web.evaluateJavascript(
                    "(function(){var button=document.getElementById('refresh');" +
                    "if(button)button.click();})()", null);
            intent.removeExtra("pitacco_assignment_alert");
        }
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("permission_setup_waiting", waitingForSystem);
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
