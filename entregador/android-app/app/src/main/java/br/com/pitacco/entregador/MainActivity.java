package br.com.pitacco.entregador;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.pm.PackageManager;
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

public class MainActivity extends Activity {
    private static final String HOST = "entregador.pitacco.com.br";
    private static final String HOME = "https://" + HOST + "/";

    private static final int PUSH_PERMISSION = 94;
    private JavaScriptReplyProxy pendingPermission;
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
        preparePush();
        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
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
                            reply.postMessage(posted ?
                                    ("ready".equals(status) ? "tested" : "channel_silent") :
                                    "channel_disabled");
                        } else reply.postMessage(status);
                    }
                    else if ("status".equals(action)) {
                        reply.postMessage("notification_status:" +
                                AssignmentMessagingService.notificationStatus(this));
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
                            settings.putExtra(Settings.EXTRA_CHANNEL_ID, AssignmentMessagingService.CHANNEL_ID);
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

    private boolean pushEnabled() {
        return getPreferences(MODE_PRIVATE).getBoolean("push_enabled", false)
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
            else reply.postMessage("token:" + result.getResult());
        });
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
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
