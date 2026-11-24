package br.com.pitacco.entregador;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.MimeTypeMap;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * In-app update only for the signed, published Pitacco courier package.
 * A normal Android device ALWAYS presents its system installer confirmation.
 * Untrusted sites, URL redirects and APK files cannot choose another app.
 */
public final class CourierAppUpdater {
    public interface Respond { void send(String text); }
    private static final Pattern OFFICIAL = Pattern.compile(
        "^https://github[.]com/juniorclerio37-creator/pitacco/releases/download/"
       +"pitacco-entregador-v([0-9]+[.][0-9]+[.][0-9]+)-[0-9a-f]{12}/"
       +"Pitacco-Entregador-([0-9]+[.][0-9]+[.][0-9]+)[.]apk$");
    private static final Pattern SHA256 = Pattern.compile("^[a-f0-9]{64}$");
    private static final int MAX_APK_BYTES = 50 * 1024 * 1024;
    private final Activity activity;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private boolean busy = false;
    private File readyForInstall;

    public CourierAppUpdater(Activity activity) { this.activity = activity; }

    public String installedVersion() {
        try {
            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return info.versionName == null ? "0.0.0" : info.versionName;
        } catch (Exception ignored) { return "0.0.0"; }
    }

    private long installedCode() {
        try {
            PackageInfo info=activity.getPackageManager().getPackageInfo(activity.getPackageName(),0);
            return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
        } catch(Exception ignored) { return 0; }
    }

    private static int compare(String left, String right) {
        String[] a=left.split("\\."), b=right.split("\\.");
        if(a.length!=3||b.length!=3)return -1;
        for(int i=0;i<3;i++){
            int delta=Integer.compare(Integer.parseInt(a[i]),Integer.parseInt(b[i]));
            if(delta!=0)return delta;
        }
        return 0;
    }

    private void reply(Respond callback, String status) {
        activity.runOnUiThread(() -> {
            try { callback.send(status); } catch(Exception ignored) {}
        });
    }

    public void install(JSONObject release, Respond callback) {
        final String version=release.optString("version","");
        final String url=release.optString("url","");
        final String sha=release.optString("sha256","").toLowerCase(Locale.ROOT);
        final String filename=release.optString("filename","");
        Matcher m=OFFICIAL.matcher(url);
        if (!m.matches()||!m.group(1).equals(version)||!m.group(2).equals(version)
                ||!filename.equals("Pitacco-Entregador-"+version+".apk")
                ||!SHA256.matcher(sha).matches()) {
            reply(callback,"update:error:Versão oficial ou integridade inválida.");
            return;
        }
        if(compare(version,installedVersion())<=0) {
            reply(callback,"update:current");return;
        }
        if(busy){reply(callback,"update:busy");return;}
        busy=true;
        readyForInstall=null;
        reply(callback,"update:downloading");
        executor.execute(()->{
            File destination=null;
            try {
                File directory=new File(activity.getCacheDir(),"courier-updates");
                if(!directory.isDirectory()&&!directory.mkdirs())throw new Exception("Pasta de atualização indisponível");
                destination=new File(directory,filename);
                if(destination.exists()&&!destination.delete())throw new Exception("Arquivo anterior inacessível");
                MessageDigest md=MessageDigest.getInstance("SHA-256");
                int total=0;
                URL next=new URL(url);
                HttpURLConnection conn=null;
                try {
                    int redirects=0;
                    while(true) {
                        if(!"https".equalsIgnoreCase(next.getProtocol()) ||
                           (!"github.com".equalsIgnoreCase(next.getHost()) &&
                             !next.getHost().toLowerCase(Locale.ROOT).endsWith(".githubusercontent.com"))) {
                            throw new Exception("Endereço de download não autorizado");
                        }
                        conn=(HttpURLConnection)next.openConnection();
                        conn.setInstanceFollowRedirects(false);
                        conn.setConnectTimeout(15000);
                        conn.setReadTimeout(30000);
                        conn.setRequestProperty("User-Agent","Pitacco-Entregador-Updater");
                        int status=conn.getResponseCode();
                        if(status==301||status==302||status==303||status==307||status==308){
                            if(++redirects>6)throw new Exception("Redirecionamentos em excesso");
                            String location=conn.getHeaderField("Location");
                            if(location==null)throw new Exception("Redirecionamento inválido");
                            next=new URL(next,location);
                            conn.disconnect();conn=null;continue;
                        }
                        if(status!=200)throw new Exception("Download indisponível ("+status+")");
                        if(conn.getContentLengthLong()>MAX_APK_BYTES)throw new Exception("Instalador muito grande");
                        break;
                    }
                    try(InputStream in=conn.getInputStream();FileOutputStream out=new FileOutputStream(destination)){
                        byte[] buffer=new byte[32768];int n;
                        while((n=in.read(buffer))!=-1){
                            total+=n;
                            if(total>MAX_APK_BYTES)throw new Exception("Instalador excede o limite");
                            out.write(buffer,0,n);md.update(buffer,0,n);
                        }
                    }
                }finally{if(conn!=null)conn.disconnect();}
                if(total<100000)throw new Exception("Instalador incompleto");
                StringBuilder digest=new StringBuilder(64);
                for(byte val:md.digest())digest.append(String.format(Locale.ROOT,"%02x",val&255));
                if(!sha.equals(digest.toString()))throw new Exception("Arquivo não corresponde ao SHA-256 oficial");
                PackageInfo archive=activity.getPackageManager().getPackageArchiveInfo(destination.getAbsolutePath(),0);
                if(archive==null||!activity.getPackageName().equals(archive.packageName)||
                    (Build.VERSION.SDK_INT>=28?archive.getLongVersionCode():archive.versionCode)<=installedCode()){
                    throw new Exception("O APK não é uma atualização válida do Pitacco Entregador");
                }
                final File file=destination;
                activity.runOnUiThread(()->{
                    busy=false;
                    readyForInstall=file;
                    reply(callback,"update:verified");
                    openInstaller(callback);
                });
            }catch(Exception e){
                if(destination!=null)destination.delete();
                final String message=e.getMessage()==null?"Falha ao baixar a atualização":e.getMessage();
                activity.runOnUiThread(()->{busy=false;readyForInstall=null;reply(callback,"update:error:"+message);});
            }
        });
    }

    private void openInstaller(Respond callback) {
        if(readyForInstall==null||!readyForInstall.isFile())return;
        if(Build.VERSION.SDK_INT>=26&&!activity.getPackageManager().canRequestPackageInstalls()){
            reply(callback,"update:permission");
            new AlertDialog.Builder(activity)
                .setTitle("Permitir instalação do Pitacco")
                .setMessage("Para atualizar pelo próprio aplicativo, o Android precisa autorizar esta fonte. A atualização oficial será instalada somente após sua confirmação.")
                .setPositiveButton("Abrir permissões",(dialog,which)->{
                    Intent intent=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:"+activity.getPackageName()));
                    try{activity.startActivity(intent);}catch(ActivityNotFoundException e){
                        reply(callback,"update:error:Abra as permissões de instalação do Pitacco nas configurações do Android");
                    }
                })
                .setNegativeButton("Agora não",(dialog,which)->reply(callback,"update:postponed"))
                .show();
            return;
        }
        try{
            Uri apk=FileProvider.getUriForFile(activity,activity.getPackageName()+".updater",readyForInstall);
            Intent install=new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apk,"application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            install.setClipData(ClipData.newUri(activity.getContentResolver(),"Pitacco update",apk));
            activity.startActivity(install);
            reply(callback,"update:installer");
        }catch(Exception e){
            reply(callback,"update:error:Não foi possível abrir a instalação do Android");
        }
    }

    public void onResume() {
        // Called on return from Android's "Install unknown apps" settings.
        // A second consent is always requested by the OS package installer.
        if(readyForInstall!=null && Build.VERSION.SDK_INT>=26 &&
            activity.getPackageManager().canRequestPackageInstalls()) {
            File pending=readyForInstall;readyForInstall=null;
            // Keep the verified file; never download a different one silently.
            try{
                Uri apk=FileProvider.getUriForFile(activity,activity.getPackageName()+".updater",pending);
                Intent install=new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(apk,"application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                install.setClipData(ClipData.newUri(activity.getContentResolver(),"Pitacco update",apk));
                activity.startActivity(install);
            }catch(Exception ignored){
                Toast.makeText(activity,"Não foi possível abrir o instalador. Verifique as permissões.",Toast.LENGTH_LONG).show();
            }
        }
    }
    public void close() { executor.shutdownNow(); }
}
