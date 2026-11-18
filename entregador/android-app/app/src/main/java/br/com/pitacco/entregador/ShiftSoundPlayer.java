package br.com.pitacco.entregador;

import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

/**
 * Opt-in courier shift alert. For a single 1.8s order chime only, request
 * a temporary alarm-stream volume increase, then restore it. Never alter
 * ringer mode, DND settings, or the notification policy.
 * Android can deny audio/volume changes; audibility cannot be guaranteed.
 */
public final class ShiftSoundPlayer {
    private static final String PREFS = "pitacco_delivery_shift_sound";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_RESTORE_PENDING = "restore_pending";
    private static final String KEY_ORIGINAL = "original_alarm_volume";
    private static final String KEY_TEMPORARY = "temporary_alarm_volume";
    private static final Handler HANDLER = new Handler(Looper.getMainLooper());
    private static MediaPlayer player;
    private static AudioManager volumeManager;
    private static Context playingContext;
    private static int originalVolume = -1;
    private static int temporaryVolume = -1;
    private static String lastResult = "off";
    private static Runnable timeoutTask;

    private ShiftSoundPlayer() {}

    private static SharedPreferences settings(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static boolean isEnabled(Context context) {
        return settings(context).getBoolean(KEY_ENABLED, false);
    }

    public static synchronized void setEnabled(Context context, boolean enabled) {
        if (!enabled) stopAndRestore();
        settings(context).edit().putBoolean(KEY_ENABLED, enabled).apply();
        lastResult = enabled ? "ready" : "off";
    }

    public static synchronized String getLastResult() {
        return lastResult;
    }

    /** Restore a pending volume override on the next app startup after a crash. */
    public static synchronized void recover(Context context) {
        SharedPreferences prefs = settings(context);
        if (!prefs.getBoolean(KEY_RESTORE_PENDING, false)) return;
        AudioManager manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        int before = prefs.getInt(KEY_ORIGINAL, -1);
        int temporary = prefs.getInt(KEY_TEMPORARY, -1);
        if (manager != null && before >= 0 && temporary >= 0) {
            try {
                // Do not undo any volume change the user made manually.
                if (manager.getStreamVolume(AudioManager.STREAM_ALARM) == temporary)
                    manager.setStreamVolume(AudioManager.STREAM_ALARM, before, 0);
            } catch (SecurityException | IllegalArgumentException ignored) {
                // Android may restrict volume changes. Never bypass policy.
            }
        }
        prefs.edit().remove(KEY_RESTORE_PENDING).remove(KEY_ORIGINAL)
                .remove(KEY_TEMPORARY).apply();
    }

    private static synchronized void stopAndRestore() {
        if (timeoutTask != null) {
            HANDLER.removeCallbacks(timeoutTask);
            timeoutTask = null;
        }
        if (player != null) {
            try { player.stop(); } catch (IllegalStateException ignored) {}
            try { player.release(); } catch (RuntimeException ignored) {}
            player = null;
        }
        if (volumeManager != null && originalVolume >= 0 && temporaryVolume >= 0) {
            try {
                if (volumeManager.getStreamVolume(AudioManager.STREAM_ALARM) == temporaryVolume)
                    volumeManager.setStreamVolume(AudioManager.STREAM_ALARM, originalVolume, 0);
            } catch (SecurityException | IllegalArgumentException ignored) {}
        }
        if (playingContext != null) {
            settings(playingContext).edit().remove(KEY_RESTORE_PENDING)
                    .remove(KEY_ORIGINAL).remove(KEY_TEMPORARY).apply();
        }
        volumeManager = null;
        playingContext = null;
        originalVolume = -1;
        temporaryVolume = -1;
    }

    /**
     * Returns "started" when playback was requested, NOT a claim that sound
     * was physically heard. Needs user testing on the actual Motorola.
     */
    public static synchronized String play(Context context) {
        if (!isEnabled(context)) return (lastResult = "off");
        stopAndRestore();
        Context app = context.getApplicationContext();
        NotificationManager notifications = (NotificationManager)
                app.getSystemService(Context.NOTIFICATION_SERVICE);
        // If the user selected total interruption blocking, do not try
        // circumventing DND or overriding their chosen restriction.
        if (notifications != null &&
                notifications.getCurrentInterruptionFilter()
                        == NotificationManager.INTERRUPTION_FILTER_NONE)
            return (lastResult = "blocked_dnd");

        AudioManager manager = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (manager == null) return (lastResult = "audio_unavailable");

        int before, raised;
        try {
            before = manager.getStreamVolume(AudioManager.STREAM_ALARM);
            raised = Math.max(before, Math.max(1,
                    (int) Math.ceil(manager.getStreamMaxVolume(AudioManager.STREAM_ALARM) * .85)));
            if (before < raised) {
                manager.setStreamVolume(AudioManager.STREAM_ALARM, raised, 0);
                if (manager.getStreamVolume(AudioManager.STREAM_ALARM) < raised)
                    return (lastResult = "volume_restricted");
                originalVolume = before;
                temporaryVolume = raised;
                volumeManager = manager;
                playingContext = app;
                settings(app).edit().putBoolean(KEY_RESTORE_PENDING, true)
                        .putInt(KEY_ORIGINAL, before)
                        .putInt(KEY_TEMPORARY, raised).apply();
            }
        } catch (SecurityException | IllegalArgumentException error) {
            stopAndRestore();
            return (lastResult = "volume_restricted");
        }

        try {
            Uri sound = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://"
                    + app.getPackageName() + "/raw/pitacco_assignment");
            MediaPlayer instance = new MediaPlayer();
            instance.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player = instance;
            instance.setDataSource(app, sound);
            instance.setVolume(1.0f, 1.0f);
            instance.setOnCompletionListener(mp -> stopAndRestore());
            instance.setOnErrorListener((mp, what, extra) -> {
                stopAndRestore();
                return true;
            });
            instance.prepare();
            instance.start();
            timeoutTask = ShiftSoundPlayer::stopAndRestore;
            HANDLER.postDelayed(timeoutTask, 3100);
            return (lastResult = "started");
        } catch (Exception error) {
            stopAndRestore();
            return (lastResult = "playback_failed");
        }
    }
}
