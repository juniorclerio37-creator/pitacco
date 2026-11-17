package br.com.pitacco.entregador;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
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
        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }

    private boolean handleLink(Uri uri) {
        String host = uri.getHost();
        if (isHttps(uri) && HOST.equalsIgnoreCase(host)) return false;
        String path = uri.getPath();
        if (isHttps(uri) && path != null && (
                ("www.google.com".equalsIgnoreCase(host) && path.startsWith("/maps/dir/"))
                || ("waze.com".equalsIgnoreCase(host) && "/ul".equals(path))
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
