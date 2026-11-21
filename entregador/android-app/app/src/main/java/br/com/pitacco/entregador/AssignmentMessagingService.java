package br.com.pitacco.entregador;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/** Receives high-priority FCM assignments even when the WebView is in the background. */
public final class AssignmentMessagingService extends FirebaseMessagingService {
    public static final String CHANNEL_ID = "pitacco_new_assignment_loud_v2";
    public static final String SHIFT_CHANNEL_ID = "pitacco_new_assignment_shift_v1";
    public static final String ADMIN_CHANNEL_ID = "pitacco_admin_messages_silent_v1";
    private static final String ADMIN_TYPE = "admin_message";
    private static final String TYPE = "new_assignment";
    private static final HashMap<String,Long> recentlyNotified = new HashMap<>();
    private static synchronized boolean firstAlertForEvent(String id) {
        // Local test is repeatable, unlike a real delivery.
        if ("00000000-0000-4000-8000-000000000001".equals(id)) return true;
        long now = android.os.SystemClock.elapsedRealtime();
        if (recentlyNotified.size() > 200) {
            recentlyNotified.clear();
        }
        Long last = recentlyNotified.get(id);
        if (last != null && now - last < 120_000L) return false;
        recentlyNotified.put(id, now);
        return true;
    }
    private static final String UUID_PATTERN =
            "(?i)[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}";

    public static void ensureChannel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        Uri sound = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://"
                + context.getPackageName() + "/raw/pitacco_assignment");
        AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Novas entregas • alerta forte", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Aviso sonoro prioritário de nova entrega do Pitacco");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 420, 150, 420, 150, 600});
        channel.setSound(sound, attributes);
        manager.createNotificationChannel(channel);
        }
        // Silent channel avoids the normal channel chime playing twice:
        // approved shift sound is played separately as an alarm stream.
        if (manager.getNotificationChannel(SHIFT_CHANNEL_ID) == null) {
            NotificationChannel shift = new NotificationChannel(
                    SHIFT_CHANNEL_ID, "Nova entrega • Som de plantão",
                    NotificationManager.IMPORTANCE_HIGH);
            shift.setDescription("Aviso forte de plantão, com volume temporário autorizado");
            shift.setSound(null, null);
            shift.enableVibration(true);
            shift.setVibrationPattern(new long[]{0, 420, 150, 420, 150, 600});
            manager.createNotificationChannel(shift);
        }
        // Do not reuse the loud order channel. Owner communications must
        // never play the courier bell, voice recording or shift sound.
        if (manager.getNotificationChannel(ADMIN_CHANNEL_ID) == null) {
            NotificationChannel silent = new NotificationChannel(
                    ADMIN_CHANNEL_ID,"Comunicados do Pitacco",
                    NotificationManager.IMPORTANCE_LOW);
            silent.setDescription("Campanhas, incentivos e comunicados do Super Admin. Sem som.");
            silent.setSound(null,null);
            silent.enableVibration(false);
            silent.setShowBadge(true);
            manager.createNotificationChannel(silent);
        }
    }

    /** Native alert availability; does not claim audio was physically heard. */
    public static String notificationStatus(Context context) {
        if (Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) return "permission";
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return "permission";
        ensureChannel(context);
        boolean shiftMode = ShiftSoundPlayer.isEnabled(context);
        NotificationChannel channel = manager.getNotificationChannel(
                shiftMode ? SHIFT_CHANNEL_ID : CHANNEL_ID);
        if (channel == null || channel.getImportance() == NotificationManager.IMPORTANCE_NONE)
            return "channel_disabled";
        if (channel.getImportance() < NotificationManager.IMPORTANCE_DEFAULT ||
                (!shiftMode && channel.getSound() == null)) return "channel_silent";
        return "ready";
    }

    public static boolean showAssignment(Context context, String eventId) {
        if (Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (!manager.areNotificationsEnabled()) return false;
        ensureChannel(context);
        boolean shiftMode = ShiftSoundPlayer.isEnabled(context);
        String channelId = shiftMode ? SHIFT_CHANNEL_ID : CHANNEL_ID;
        NotificationChannel channel = manager.getNotificationChannel(channelId);
        if (channel == null ||
                channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        Intent launch = new Intent(context, MainActivity.class);
        launch.putExtra("pitacco_assignment_alert", true);
        launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent click = PendingIntent.getActivity(context, 1, launch,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notice = new Notification.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_pitacco)
                .setContentTitle("Pitacco Entregador")
                .setContentText("Você tem uma nova entrega! Abra o aplicativo para conferir.")
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setAutoCancel(true)
                .setContentIntent(click)
                .build();
        // The foreground-service fallback and Firebase use the SAME event UUID.
        // Never play twice if both deliver the same assignment.
        if (!firstAlertForEvent(eventId)) return true;
        manager.notify(eventId.hashCode(), notice);
        if (shiftMode) ShiftSoundPlayer.play(context);
        return true;
    }

    /** Completely separate, silent admin message: no bell, voice, or
     * ShiftSoundPlayer call. Only deliverable with OS notification permission. */
    public static boolean showAdminMessage(Context context,String id,
                                           String title,String body) {
        if (Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        if(manager==null || !manager.areNotificationsEnabled())return false;
        ensureChannel(context);
        NotificationChannel channel=manager.getNotificationChannel(ADMIN_CHANNEL_ID);
        if(channel==null || channel.getImportance()==NotificationManager.IMPORTANCE_NONE)
            return false;
        if(!firstAlertForEvent(id))return true;
        Intent open=new Intent(context,MainActivity.class);
        open.putExtra("pitacco_admin_message",true);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent click=PendingIntent.getActivity(context,id.hashCode(),open,
            PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        String safeTitle=title==null?"Comunicado":title.trim();
        String safeBody=body==null?"":body.trim();
        if(safeTitle.isEmpty())safeTitle="Comunicado";
        if(safeTitle.length()>80)safeTitle=safeTitle.substring(0,80);
        if(safeBody.length()>400)safeBody=safeBody.substring(0,400);
        Notification notice=new Notification.Builder(context,ADMIN_CHANNEL_ID)
          .setSmallIcon(R.drawable.ic_pitacco)
          .setContentTitle("Pitacco • "+safeTitle)
          .setContentText(safeBody)
          .setStyle(new Notification.BigTextStyle().bigText(safeBody))
          .setCategory(Notification.CATEGORY_MESSAGE)
          .setVisibility(Notification.VISIBILITY_PRIVATE)
          .setAutoCancel(true)
          .setContentIntent(click)
          .setDefaults(0)
          .setSound(null)
          .build();
        manager.notify(id.hashCode(),notice);
        return true;
    }

    @Override public void onMessageReceived(RemoteMessage message) {
        // Opt-out and logout must prevent audible/native delivery alerts, even
        // when an old token remains registered while the device is offline.
        // The production app sends data-only FCM events to this native handler.
        if (!MainActivity.isPushOptedIn(this)) return;
        String kind=message.getData().get("kind");
        String eventId=message.getData().get("event_id");
        if(eventId==null||!eventId.matches(UUID_PATTERN))return;
        if(ADMIN_TYPE.equals(kind)){
            // Admin text lives in a silent notification channel, never on
            // the delivery alert path. No customer or order data included.
            showAdminMessage(this,eventId,
                message.getData().get("title"),message.getData().get("body"));
            return;
        }
        if (!TYPE.equals(kind))return;
        // Only active order events may use the recorded bell and courier voice.
        showAssignment(this,eventId);
    }
}
